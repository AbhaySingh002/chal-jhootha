package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"chal-jhootha-server/internal/live"
	"chal-jhootha-server/internal/logger"
	"chal-jhootha-server/internal/room"
	"chal-jhootha-server/internal/store"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName      = "cj_session"
	SessionTTL      = 10 * 365 * 24 * time.Hour
	GuestSessionTTL = 24 * time.Hour
	WSTicketTTL     = 45 * time.Second
)

type EventBroadcaster interface {
	SendToUser(userID string, payload []byte) bool
}

type Service struct {
	Store       *store.Store
	Runtime     *live.Runtime
	Rooms       *room.Manager
	Broadcaster EventBroadcaster
}

func (s *Service) MarkOnline(ctx context.Context, user *store.User) {
	if s.Runtime == nil || user == nil || !user.IsRegistered {
		return
	}
	_ = s.Runtime.SetPresence(ctx, user.ID, 45*time.Second)
}

type wsTicketEntry struct {
	user      *store.User
	expiresAt time.Time
}

type sessionEntry struct {
	user      *store.User
	expiresAt time.Time
}

type guestClaim struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Exp  int64  `json:"exp"`
}

var (
	memWsTickets sync.Map
	memSessions  sync.Map
)

func deleteMemoryTicketsForUser(userID string) {
	memWsTickets.Range(func(key, value any) bool {
		entry, ok := value.(wsTicketEntry)
		if ok && entry.user != nil && entry.user.ID == userID {
			memWsTickets.Delete(key)
		}
		return true
	})
}

func deleteMemorySessionsForUser(userID string) {
	memSessions.Range(func(key, value any) bool {
		entry, ok := value.(sessionEntry)
		if ok && entry.user != nil && entry.user.ID == userID {
			memSessions.Delete(key)
		}
		return true
	})
}

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email,omitempty"`
	DisplayName  string `json:"name"`
	IsRegistered bool   `json:"isRegistered"`
	Handle       string `json:"handle,omitempty"`
	HasProfile   bool   `json:"hasProfile"`
	AvatarID     string `json:"avatarId,omitempty"`
}

var handlePattern = regexp.MustCompile(`^[a-z0-9_]{3,16}$`)

func normalizeHandle(raw string) (string, bool) {
	handle := strings.ToLower(strings.TrimSpace(raw))
	return handle, handlePattern.MatchString(handle)
}

func (s *Service) UserFromRequest(r *http.Request) (*store.User, string, bool) {
	token := tokenFromRequest(r)
	if token == "" {
		return nil, "", false
	}
	if guest, ok := guestFromToken(token); ok {
		return guest, token, true
	}

	// 1. Fast in-memory session lookup
	if val, ok := memSessions.Load(token); ok {
		entry := val.(sessionEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.user, token, true
		}
		memSessions.Delete(token)
	}

	// 2. Fast in-memory WS ticket lookup
	if val, ok := memWsTickets.Load(token); ok {
		entry := val.(wsTicketEntry)
		memWsTickets.Delete(token)
		if time.Now().Before(entry.expiresAt) && entry.user != nil {
			return entry.user, token, true
		}
	}

	// 3. Fallback to database session store
	if s.Store == nil {
		return nil, token, false
	}
	userID, ok, err := s.Store.GetSession(token)
	if err != nil {
		return nil, token, false
	}
	if !ok {
		userID, ok, err = s.Store.ConsumeWSTicket(token)
		if err != nil || !ok {
			return nil, token, false
		}
	}
	u, err := s.Store.GetUser(userID)
	if err != nil || u == nil {
		return nil, token, false
	}

	// Cache validated session in RAM for 5 minutes
	memSessions.Store(token, sessionEntry{
		user:      u,
		expiresAt: time.Now().Add(5 * time.Minute),
	})

	return u, token, true
}

func tokenFromRequest(r *http.Request) string {
	if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
		return c.Value
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	for _, protocol := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
		protocol = strings.TrimSpace(protocol)
		if strings.HasPrefix(protocol, "cj-auth-") {
			return strings.TrimPrefix(protocol, "cj-auth-")
		}
	}
	if ticket := strings.TrimSpace(r.URL.Query().Get("ticket")); ticket != "" {
		return ticket
	}
	return ""
}

func (s *Service) setCookie(w http.ResponseWriter, token string, ttl time.Duration) {
	secure := os.Getenv("COOKIE_SECURE") == "1" || os.Getenv("ENV") == "production"
	sameSite := cookieSameSite()
	if sameSite == http.SameSiteNoneMode {
		secure = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: sameSite,
	})
}

func guestSessionSecret() []byte {
	if raw := strings.TrimSpace(os.Getenv("GUEST_SESSION_SECRET")); raw != "" {
		return []byte(raw)
	}
	// Local development must work without extra setup. Production deployments
	// should always set GUEST_SESSION_SECRET so sessions survive replacement.
	return []byte("chal-jhootha-development-guest-session-secret")
}

func newGuestToken(id, name string) (string, error) {
	claims, err := json.Marshal(guestClaim{ID: id, Name: name, Exp: time.Now().Add(GuestSessionTTL).Unix()})
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(claims)
	mac := hmac.New(sha256.New, guestSessionSecret())
	_, _ = mac.Write([]byte(payload))
	return "g." + payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func guestFromToken(token string) (*store.User, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "g" {
		return nil, false
	}
	mac := hmac.New(sha256.New, guestSessionSecret())
	_, _ = mac.Write([]byte(parts[1]))
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, mac.Sum(nil)) {
		return nil, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var claim guestClaim
	if json.Unmarshal(payload, &claim) != nil || claim.ID == "" || claim.Name == "" || time.Now().Unix() >= claim.Exp {
		return nil, false
	}
	return &store.User{ID: claim.ID, DisplayName: claim.Name, IsEphemeralGuest: true}, true
}

func (s *Service) clearCookie(w http.ResponseWriter) {
	secure := os.Getenv("COOKIE_SECURE") == "1" || os.Getenv("ENV") == "production"
	sameSite := cookieSameSite()
	if sameSite == http.SameSiteNoneMode {
		secure = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: sameSite,
	})
}

func cookieSameSite() http.SameSite {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("COOKIE_SAME_SITE"))) {
	case "none":
		return http.SameSiteNoneMode
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *Service) issueSession(w http.ResponseWriter, userID string) error {
	token, err := randomToken()
	if err != nil {
		return err
	}
	if err := s.Store.PutSession(token, userID, SessionTTL); err != nil {
		return err
	}
	if u, err := s.Store.GetUser(userID); err == nil && u != nil {
		memSessions.Store(token, sessionEntry{
			user:      u,
			expiresAt: time.Now().Add(5 * time.Minute),
		})
	}
	s.setCookie(w, token, SessionTTL)
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Service) publicUser(u *store.User) User {
	out := User{ID: u.ID, DisplayName: u.DisplayName, IsRegistered: u.IsRegistered}
	if u.Email.Valid {
		out.Email = u.Email.String
	}
	if u.IsRegistered {
		if profile, err := s.Store.GetProfile(u.ID); err == nil {
			out.Handle = profile.Handle
			out.HasProfile = true
			out.AvatarID = profile.AvatarID
		}
	}
	return out
}

func (s *Service) HandleRegister(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Handle   string `json:"handle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	body.Name = strings.TrimSpace(body.Name)
	handle, validHandle := normalizeHandle(body.Handle)
	if body.Email == "" || len(body.Password) < 6 || body.Name == "" || !validHandle {
		writeJSON(w, 400, map[string]string{"error": "email, password (6+), name, and a 3-16 character handle are required"})
		return
	}
	existing, err := s.Store.GetUserByEmail(body.Email)
	if err != nil || existing != nil {
		writeJSON(w, 409, map[string]string{"error": "email already registered"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "hash failed"})
		return
	}
	id := uuid.NewString()
	email, ph := body.Email, string(hash)
	if err := s.Store.CreateRegisteredUser(id, body.Name, email, ph, handle); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeJSON(w, 409, map[string]string{"error": "handle already in use"})
			return
		}
		writeJSON(w, 500, map[string]string{"error": "create failed"})
		return
	}
	if err := s.issueSession(w, id); err != nil {
		writeJSON(w, 500, map[string]string{"error": "session failed"})
		return
	}
	logger.Info("AUTH", "User registered", "userId", id)
	u, _ := s.Store.GetUser(id)
	writeJSON(w, 201, map[string]any{"user": s.publicUser(u)})
}

func (s *Service) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	u, err := s.Store.GetUserByEmail(strings.ToLower(strings.TrimSpace(body.Email)))
	if err != nil || u == nil || !u.PasswordHash.Valid {
		writeJSON(w, 401, map[string]string{"error": "invalid credentials"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash.String), []byte(body.Password)) != nil {
		writeJSON(w, 401, map[string]string{"error": "invalid credentials"})
		return
	}
	if err := s.issueSession(w, u.ID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "session failed"})
		return
	}
	logger.Info("AUTH", "User logged in", "userId", u.ID)
	writeJSON(w, 200, map[string]any{"user": s.publicUser(u)})
}

func (s *Service) HandleGuest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		ForceNew bool   `json:"forceNew"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if u, _, ok := s.UserFromRequest(r); ok {
		room := ""
		if !u.IsEphemeralGuest {
			room, _, _ = s.Store.GetUserRoom(u.ID)
			writeJSON(w, 200, map[string]any{"user": s.publicUser(u), "activeRoomCode": room})
			return
		}
		if !body.ForceNew {
			writeJSON(w, 200, map[string]any{"user": s.publicUser(u), "activeRoomCode": room})
			return
		}
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a guest alias is required"})
		return
	}
	if len(name) > 16 {
		name = name[:16]
	}
	id := uuid.NewString()
	token, err := newGuestToken(id, name)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "session failed"})
		return
	}
	s.setCookie(w, token, GuestSessionTTL)
	logger.Info("AUTH", "Guest session created", "userId", id)
	writeJSON(w, 201, map[string]any{"user": s.publicUser(&store.User{ID: id, DisplayName: name, IsEphemeralGuest: true})})
}

// HandleClearGuest removes only an ephemeral browser identity. Registered
// sessions are intentionally untouched, so leaving a room never signs a
// player out of their account.
func (s *Service) HandleClearGuest(w http.ResponseWriter, r *http.Request) {
	if u, _, ok := s.UserFromRequest(r); ok && u.IsEphemeralGuest {
		s.clearCookie(w)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if u, token, ok := s.UserFromRequest(r); ok {
		deleteMemoryTicketsForUser(u.ID)
		if !u.IsEphemeralGuest {
			_ = s.Store.DeleteWSTicketsForUser(u.ID)
		}
		if token != "" && !u.IsEphemeralGuest {
			memSessions.Delete(token)
			_ = s.Store.DeleteSession(token)
		}
	} else if c, err := r.Cookie(CookieName); err == nil {
		memSessions.Delete(c.Value)
		_ = s.Store.DeleteSession(c.Value)
	}
	s.clearCookie(w)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func (s *Service) HandleWsTicket(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.UserFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	ticket, err := randomToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "ticket failed"})
		return
	}

	// 1. Fast in-memory registration for immediate WS connect
	memWsTickets.Store(ticket, wsTicketEntry{
		user:      u,
		expiresAt: time.Now().Add(WSTicketTTL),
	})

	// Registered users retain a database fallback across process replacement.
	// Stateless guest tickets are intentionally memory-only; their signed cookie
	// can mint a fresh ticket immediately after a reconnect.
	if !u.IsEphemeralGuest {
		go func() {
			_ = s.Store.PutWSTicket(ticket, u.ID, WSTicketTTL)
		}()
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ticket":    ticket,
		"expiresIn": int(WSTicketTTL.Seconds()),
	})
}

func (s *Service) HandleSession(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.UserFromRequest(r)
	if !ok {
		writeJSON(w, 200, map[string]any{"user": nil})
		return
	}
	room := ""
	if !u.IsEphemeralGuest {
		room, _, _ = s.Store.GetUserRoom(u.ID)
	}
	writeJSON(w, 200, map[string]any{"user": s.publicUser(u), "activeRoomCode": room})
}

// HandleTurnCredentials implements coturn's REST authentication format. TURN
// stays optional for local development; without TURN_URLS the client retains
// STUN-only behavior rather than receiving unusable placeholder credentials.
func (s *Service) HandleTurnCredentials(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.UserFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	urls := make([]string, 0)
	for _, raw := range strings.Split(os.Getenv("TURN_URLS"), ",") {
		if value := strings.TrimSpace(raw); value != "" {
			urls = append(urls, value)
		}
	}
	secret := strings.TrimSpace(os.Getenv("TURN_SHARED_SECRET"))
	if len(urls) == 0 || secret == "" {
		writeJSON(w, http.StatusOK, map[string]any{"iceServers": []map[string]any{{"urls": []string{"stun:stun.l.google.com:19302"}}}})
		return
	}
	expiresAt := time.Now().Add(15 * time.Minute).Unix()
	username := strconv.FormatInt(expiresAt, 10) + ":" + u.ID
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte(username))
	credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	writeJSON(w, http.StatusOK, map[string]any{
		"iceServers": []map[string]any{
			{"urls": []string{"stun:stun.l.google.com:19302"}},
			{"urls": urls, "username": username, "credential": credential},
		},
		"expiresIn": 900,
	})
}

type OriginPolicy struct {
	allowed map[string]struct{}
}

func NewOriginPolicy(raw string) *OriginPolicy {
	if strings.TrimSpace(raw) == "" {
		raw = os.Getenv("FRONTEND_ORIGINS")
	}
	if strings.TrimSpace(raw) == "" {
		raw = os.Getenv("FRONTEND_ORIGIN")
	}
	if strings.TrimSpace(raw) == "" {
		raw = "http://localhost:5173"
	}
	allowed := make(map[string]struct{})
	for _, origin := range strings.Split(raw, ",") {
		origin = strings.TrimRight(strings.TrimSpace(origin), "/")
		if origin != "" {
			allowed[origin] = struct{}{}
		}
	}
	return &OriginPolicy{allowed: allowed}
}

func (p *OriginPolicy) IsAllowed(origin string) bool {
	if p == nil {
		return false
	}
	_, ok := p.allowed[strings.TrimRight(strings.TrimSpace(origin), "/")]
	return ok
}

func CORS(policy *OriginPolicy) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && policy.IsAllowed(origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
				w.Header().Add("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				if !policy.IsAllowed(origin) {
					http.Error(w, "origin not allowed", http.StatusForbidden)
					return
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if isUnsafeMethod(r.Method) && origin != "" && !policy.IsAllowed(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isUnsafeMethod(method string) bool {
	return method == http.MethodPost || method == http.MethodPatch || method == http.MethodPut || method == http.MethodDelete
}
