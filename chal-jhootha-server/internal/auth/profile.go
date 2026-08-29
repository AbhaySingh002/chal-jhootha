package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"chal-jhootha-server/internal/store"
)

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
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	handle, valid := normalizeHandle(body.Handle)
	displayName := strings.TrimSpace(body.DisplayName)
	if !valid || displayName == "" || len(displayName) > 16 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provide a valid handle and a display name up to 16 characters"})
		return
	}
	profile, err := s.Store.UpdateProfile(u.ID, handle, displayName)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "handle already in use"})
			return
		}
		writeProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile})
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
	writeJSON(w, http.StatusOK, map[string]any{"friendships": friends})
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
