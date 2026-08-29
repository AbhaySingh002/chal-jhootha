package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"chal-jhootha-server/internal/logger"
	"chal-jhootha-server/internal/store"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName  = "cj_session"
	SessionTTL  = 30 * 24 * time.Hour
	WSTicketTTL = 45 * time.Second
)

type Service struct {
	Store *store.Store
}

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email,omitempty"`
	DisplayName  string `json:"name"`
	IsRegistered bool   `json:"isRegistered"`
	Handle       string `json:"handle,omitempty"`
	HasProfile   bool   `json:"hasProfile"`
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
	return u, token, true
}

func tokenFromRequest(r *http.Request) string {
	if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
		return c.Value
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	if ticket := strings.TrimSpace(r.URL.Query().Get("ticket")); ticket != "" {
		return ticket
	}
	return ""
}

func (s *Service) setCookie(w http.ResponseWriter, token string) {
	secure := os.Getenv("COOKIE_SECURE") == "1" || os.Getenv("ENV") == "production"
	sameSite := cookieSameSite()
	if sameSite == http.SameSiteNoneMode {
		secure = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: sameSite,
	})
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
	s.setCookie(w, token)
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
	if u, _, ok := s.UserFromRequest(r); ok {
		room, _, _ := s.Store.GetUserRoom(u.ID)
		writeJSON(w, 200, map[string]any{"user": s.publicUser(u), "activeRoomCode": room})
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "GUEST"
	}
	if len(name) > 16 {
		name = name[:16]
	}
	id := uuid.NewString()
	if err := s.Store.CreateUser(id, name, nil, nil); err != nil {
		writeJSON(w, 500, map[string]string{"error": "create failed"})
		return
	}
	if err := s.issueSession(w, id); err != nil {
		writeJSON(w, 500, map[string]string{"error": "session failed"})
		return
	}
	logger.Info("AUTH", "Guest session created", "userId", id)
	u, _ := s.Store.GetUser(id)
	writeJSON(w, 201, map[string]any{"user": s.publicUser(u)})
}

func (s *Service) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if u, token, ok := s.UserFromRequest(r); ok {
		_ = s.Store.DeleteWSTicketsForUser(u.ID)
		if token != "" {
			_ = s.Store.DeleteSession(token)
		}
	} else if c, err := r.Cookie(CookieName); err == nil {
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
	if err := s.Store.PutWSTicket(ticket, u.ID, WSTicketTTL); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "ticket failed"})
		return
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
	room, _, _ := s.Store.GetUserRoom(u.ID)
	writeJSON(w, 200, map[string]any{"user": s.publicUser(u), "activeRoomCode": room})
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
