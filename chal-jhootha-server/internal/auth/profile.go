package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"chal-jhootha-server/internal/store"
)

var avatarCatalog = map[string]struct{}{
	"ace-spades": {}, "king-hearts": {}, "queen-diamonds": {},
	"jack-clubs": {}, "joker-red": {}, "joker-black": {},
}

func validAvatarID(value string) bool {
	_, ok := avatarCatalog[value]
	return ok
}

func (s *Service) registeredUser(w http.ResponseWriter, r *http.Request) (*store.User, bool) {
	u, _, ok := s.UserFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return nil, false
	}
	if !u.IsRegistered {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "registered account required"})
		return nil, false
	}
	return u, true
}

func writeProfileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrProfileNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "profile not found"})
	case errors.Is(err, store.ErrNotRegistered):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "registered account required"})
	case errors.Is(err, store.ErrFriendExists):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "already friends"})
	case errors.Is(err, store.ErrFriendPending):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "friend request already pending"})
	case errors.Is(err, store.ErrInvalidFriendship):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "friendship action is not allowed"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "request failed"})
	}
}

func (s *Service) HandleMyProfile(w http.ResponseWriter, r *http.Request) {
	u, ok := s.registeredUser(w, r)
	if !ok {
		return
	}
	profile, err := s.Store.GetProfile(u.ID)
	if errors.Is(err, store.ErrProfileNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"profile": nil, "requiresProfile": true})
		return
	}
	if err != nil {
		writeProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "requiresProfile": false})
}

func (s *Service) HandleCreateProfile(w http.ResponseWriter, r *http.Request) {
	u, ok := s.registeredUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Handle string `json:"handle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	handle, valid := normalizeHandle(body.Handle)
	if !valid {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "handle must be 3-16 lowercase letters, digits, or underscores"})
		return
	}
	profile, err := s.Store.CreateProfile(u.ID, handle)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "handle already in use"})
			return
		}
		writeProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"profile": profile})
}

func (s *Service) HandleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	u, ok := s.registeredUser(w, r)
	if !ok {
		return
	}
	var body struct {
		Handle      string `json:"handle"`
		DisplayName string `json:"displayName"`
		AvatarID    string `json:"avatarId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	handle, valid := normalizeHandle(body.Handle)
	displayName := strings.TrimSpace(body.DisplayName)
	if !valid || displayName == "" || len(displayName) > 16 || !validAvatarID(body.AvatarID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provide a valid handle, display name, and bundled avatar"})
		return
	}
	profile, err := s.Store.UpdateProfile(u.ID, handle, displayName, body.AvatarID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "handle already in use"})
			return
		}
		writeProfileError(w, err)
		return
	}
	// The session cache contains the old display name/avatar. Clearing this
	// user's cache makes the next HTTP or WebSocket ticket read the durable
	// profile immediately.
	deleteMemorySessionsForUser(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
}

func (s *Service) HandleUpdatePassword(w http.ResponseWriter, r *http.Request) {
	u, ok := s.registeredUser(w, r)
	if !ok {
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if len(body.NewPassword) < 6 || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash.String), []byte(body.CurrentPassword)) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "current password is incorrect or the new password is too short"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "password update failed"})
		return
	}
	if err := s.Store.UpdatePassword(u.ID, string(hash)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "password update failed"})
		return
	}
	deleteMemoryTicketsForUser(u.ID)
	deleteMemorySessionsForUser(u.ID)
	_ = s.Store.DeleteWSTicketsForUser(u.ID)
	if err := s.Store.DeleteSessionsForUser(u.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "session reset failed"})
		return
	}
	if err := s.issueSession(w, u.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "session reset failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) HandlePublicProfile(w http.ResponseWriter, r *http.Request) {
	handle := strings.TrimSpace(chi.URLParam(r, "handle"))
	if handle == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "handle required"})
		return
	}
	viewerID := ""
	if u, _, ok := s.UserFromRequest(r); ok && u.IsRegistered {
		viewerID = u.ID
	}
	profile, friendshipState, err := s.Store.GetProfileByHandle(handle, viewerID)
	if err != nil {
		writeProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "friendshipState": friendshipState})
}

func (s *Service) profileEnabledUser(w http.ResponseWriter, r *http.Request) (*store.User, bool) {
	u, ok := s.registeredUser(w, r)
	if !ok {
		return nil, false
	}
	if _, err := s.Store.GetProfile(u.ID); err != nil {
		if errors.Is(err, store.ErrProfileNotFound) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "complete your profile first"})
		} else {
			writeProfileError(w, err)
		}
		return nil, false
	}
	return u, true
}

func (s *Service) HandleFriendships(w http.ResponseWriter, r *http.Request) {
	u, ok := s.profileEnabledUser(w, r)
	if !ok {
		return
	}
	friends, err := s.Store.ListFriendships(u.ID)
	if err != nil {
		writeProfileError(w, err)
		return
	}
	if s.Runtime != nil {
		for i := range friends {
			online, err := s.Runtime.IsOnline(r.Context(), friends[i].Profile.UserID)
			if err == nil {
				friends[i].Online = online
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"friendships": friends})
}

type roomInvite struct {
	Token       string    `json:"token"`
	RoomCode    string    `json:"roomCode"`
	HostID      string    `json:"hostId"`
	HostName    string    `json:"hostName"`
	RecipientID string    `json:"recipientId"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

func (s *Service) HandleCreateRoomInvite(w http.ResponseWriter, r *http.Request) {
	u, ok := s.profileEnabledUser(w, r)
	if !ok {
		return
	}
	if s.Runtime == nil || s.Rooms == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live invitations are temporarily unavailable"})
		return
	}
	var body struct {
		RoomCode     string `json:"roomCode"`
		TargetUserID string `json:"targetUserId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RoomCode == "" || body.TargetUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "room code and invited friend are required"})
		return
	}
	if !s.Rooms.IsLobbyHost(strings.ToUpper(body.RoomCode), u.ID) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "only the active room host can invite friends"})
		return
	}
	friends, err := s.Store.AreFriends(u.ID, body.TargetUserID)
	if err != nil || !friends {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "you can invite accepted friends only"})
		return
	}
	online, err := s.Runtime.IsOnline(r.Context(), body.TargetUserID)
	if err != nil || !online {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "that friend is not online"})
		return
	}
	if existingRoom, found, _ := s.Store.GetUserRoom(body.TargetUserID); found && existingRoom != "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "that friend is already in another room"})
		return
	}
	invite := roomInvite{
		Token: uuid.NewString(), RoomCode: strings.ToUpper(body.RoomCode), HostID: u.ID,
		HostName: u.DisplayName, RecipientID: body.TargetUserID, ExpiresAt: time.Now().Add(10 * time.Minute),
	}
	raw, _ := json.Marshal(invite)
	if err := s.Runtime.PutInvite(r.Context(), invite.Token, invite.RecipientID, string(raw)); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "could not send invitation"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"invite": invite})
}

func (s *Service) HandleRoomInvites(w http.ResponseWriter, r *http.Request) {
	u, ok := s.profileEnabledUser(w, r)
	if !ok {
		return
	}
	if s.Runtime == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live invitations are temporarily unavailable"})
		return
	}
	rawInvites, err := s.Runtime.ListInvites(r.Context(), u.ID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "could not load invitations"})
		return
	}
	invites := make([]roomInvite, 0, len(rawInvites))
	for _, raw := range rawInvites {
		var invite roomInvite
		if json.Unmarshal([]byte(raw), &invite) == nil && invite.RecipientID == u.ID && time.Now().Before(invite.ExpiresAt) {
			invites = append(invites, invite)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": invites})
}

func (s *Service) HandleRoomInviteResponse(accept bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.profileEnabledUser(w, r)
		if !ok {
			return
		}
		if s.Runtime == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live invitations are temporarily unavailable"})
			return
		}
		token := chi.URLParam(r, "token")
		raw, err := s.Runtime.TakeInvite(r.Context(), token)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "invitation has expired"})
			return
		}
		_ = s.Runtime.RemoveInviteToken(r.Context(), u.ID, token)
		var invite roomInvite
		if json.Unmarshal([]byte(raw), &invite) != nil || invite.RecipientID != u.ID || time.Now().After(invite.ExpiresAt) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "invitation is invalid"})
			return
		}
		if !accept {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if s.Rooms == nil || !s.Rooms.IsLobbyHost(invite.RoomCode, invite.HostID) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "this room is no longer available to join"})
			return
		}
		if existingRoom, found, _ := s.Store.GetUserRoom(u.ID); found && existingRoom != "" && existingRoom != invite.RoomCode {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "leave your current room before accepting an invite"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"roomCode": invite.RoomCode})
	}
}

func (s *Service) HandleCreateFriendRequest(w http.ResponseWriter, r *http.Request) {
	u, ok := s.profileEnabledUser(w, r)
	if !ok {
		return
	}
	var body struct {
		TargetUserID string `json:"targetUserId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TargetUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "target user required"})
		return
	}
	if err := s.Store.CreateFriendRequest(u.ID, body.TargetUserID); err != nil {
		writeProfileError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) HandleFriendResponse(accept bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.profileEnabledUser(w, r)
		if !ok {
			return
		}
		if err := s.Store.RespondToFriendRequest(u.ID, chi.URLParam(r, "id"), accept); err != nil {
			writeProfileError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Service) HandleRemoveFriendship(w http.ResponseWriter, r *http.Request) {
	u, ok := s.profileEnabledUser(w, r)
	if !ok {
		return
	}
	if err := s.Store.RemoveFriendship(u.ID, chi.URLParam(r, "id")); err != nil {
		writeProfileError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) HandleRecentPlayers(w http.ResponseWriter, r *http.Request) {
	u, ok := s.profileEnabledUser(w, r)
	if !ok {
		return
	}
	players, err := s.Store.ListRecentPlayers(u.ID, 20)
	if err != nil {
		writeProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"players": players})
}
