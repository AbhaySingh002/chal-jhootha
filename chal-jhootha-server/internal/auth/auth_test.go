package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"chal-jhootha-server/internal/auth"
	"chal-jhootha-server/internal/teststore"

	"github.com/stretchr/testify/require"
)

func TestGuestAndLogin(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/guest", bytes.NewBufferString(`{"name":"ZED"}`))
	svc.HandleGuest(rec, req)
	require.Equal(t, 201, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.NotNil(t, body["user"])

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewBufferString(`{"email":"a@b.c","password":"secret1","name":"Ann","handle":"ann_cards"}`))
	svc.HandleRegister(rec2, req2)
	require.Equal(t, 201, rec2.Code)

	rec3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(`{"email":"a@b.c","password":"secret1"}`))
	svc.HandleLogin(rec3, req3)
	require.Equal(t, 200, rec3.Code)
}

func TestGuestSessionIsStatelessAndLogoutRevokesMemoryTicket(t *testing.T) {
	svc := &auth.Service{}
	guest := httptest.NewRecorder()
	svc.HandleGuest(guest, httptest.NewRequest(http.MethodPost, "/api/auth/guest", bytes.NewBufferString(`{"name":"ZED"}`)))
	require.Equal(t, http.StatusCreated, guest.Code)
	cookies := guest.Result().Cookies()
	require.Len(t, cookies, 1)

	identity := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	identity.AddCookie(cookies[0])
	user, _, ok := svc.UserFromRequest(identity)
	require.True(t, ok)
	require.True(t, user.IsEphemeralGuest)

	mint := httptest.NewRecorder()
	mintReq := httptest.NewRequest(http.MethodPost, "/api/auth/ws-ticket", nil)
	mintReq.AddCookie(cookies[0])
	svc.HandleWsTicket(mint, mintReq)
	require.Equal(t, http.StatusOK, mint.Code)
	var ticket struct {
		Ticket string `json:"ticket"`
	}
	require.NoError(t, json.Unmarshal(mint.Body.Bytes(), &ticket))
	require.NotEmpty(t, ticket.Ticket)

	logout := httptest.NewRecorder()
	logoutReq := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logoutReq.AddCookie(cookies[0])
	svc.HandleLogout(logout, logoutReq)
	require.Equal(t, http.StatusOK, logout.Code)

	reusedTicket := httptest.NewRequest(http.MethodGet, "/ws?ticket="+ticket.Ticket, nil)
	_, _, ok = svc.UserFromRequest(reusedTicket)
	require.False(t, ok)
}

func TestWebSocketTicketCanUseSubprotocol(t *testing.T) {
	svc := &auth.Service{}
	guest := httptest.NewRecorder()
	svc.HandleGuest(guest, httptest.NewRequest(http.MethodPost, "/api/auth/guest", bytes.NewBufferString(`{"name":"ZED"}`)))
	cookie := guest.Result().Cookies()[0]

	mint := httptest.NewRecorder()
	mintReq := httptest.NewRequest(http.MethodPost, "/api/auth/ws-ticket", nil)
	mintReq.AddCookie(cookie)
	svc.HandleWsTicket(mint, mintReq)
	var ticket struct {
		Ticket string `json:"ticket"`
	}
	require.NoError(t, json.Unmarshal(mint.Body.Bytes(), &ticket))

	wsRequest := httptest.NewRequest(http.MethodGet, "/ws", nil)
	wsRequest.Header.Set("Sec-WebSocket-Protocol", "cj-v1, cj-auth-"+ticket.Ticket)
	user, _, ok := svc.UserFromRequest(wsRequest)
	require.True(t, ok)
	require.True(t, user.IsEphemeralGuest)
}

func TestProfileEndpointsRejectGuestAccounts(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}

	guest := httptest.NewRecorder()
	svc.HandleGuest(guest, httptest.NewRequest(http.MethodPost, "/api/auth/guest", bytes.NewBufferString(`{"name":"ZED"}`)))
	require.Equal(t, http.StatusCreated, guest.Code)
	cookies := guest.Result().Cookies()
	require.Len(t, cookies, 1)

	profile := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/profile/me", nil)
	request.AddCookie(cookies[0])
	svc.HandleMyProfile(profile, request)
	require.Equal(t, http.StatusForbidden, profile.Code)
}

func TestCORSAllowsConfiguredPatchAndRejectsUnknownOrigin(t *testing.T) {
	policy := auth.NewOriginPolicy("https://bluff.vercel.app")
	handler := auth.CORS(policy)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	preflight := httptest.NewRecorder()
	preflightReq := httptest.NewRequest(http.MethodOptions, "/api/profile/me", nil)
	preflightReq.Header.Set("Origin", "https://bluff.vercel.app")
	preflightReq.Header.Set("Access-Control-Request-Method", http.MethodPatch)
	handler.ServeHTTP(preflight, preflightReq)
	require.Equal(t, http.StatusNoContent, preflight.Code)
	require.Contains(t, preflight.Header().Get("Access-Control-Allow-Methods"), http.MethodDelete)

	rejected := httptest.NewRecorder()
	rejectedReq := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	rejectedReq.Header.Set("Origin", "https://malicious.example")
	handler.ServeHTTP(rejected, rejectedReq)
	require.Equal(t, http.StatusForbidden, rejected.Code)
}

func TestCrossSiteSessionCookieIsSecure(t *testing.T) {
	t.Setenv("COOKIE_SAME_SITE", "none")
	t.Setenv("COOKIE_SECURE", "0")
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}

	rec := httptest.NewRecorder()
	svc.HandleGuest(rec, httptest.NewRequest(http.MethodPost, "/api/auth/guest", bytes.NewBufferString(`{"name":"ZED"}`)))
	require.Equal(t, http.StatusCreated, rec.Code)
	cookies := rec.Result().Cookies()
	require.Len(t, cookies, 1)
	require.True(t, cookies[0].Secure)
	require.Equal(t, http.SameSiteNoneMode, cookies[0].SameSite)
}

func guestCookie(t *testing.T, svc *auth.Service) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	svc.HandleGuest(rec, httptest.NewRequest(http.MethodPost, "/api/auth/guest", bytes.NewBufferString(`{"name":"ZED"}`)))
	require.Equal(t, http.StatusCreated, rec.Code)
	cookies := rec.Result().Cookies()
	require.Len(t, cookies, 1)
	return cookies[0]
}

func TestWsTicketRequiresAuth(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}

	rec := httptest.NewRecorder()
	svc.HandleWsTicket(rec, httptest.NewRequest(http.MethodPost, "/api/auth/ws-ticket", nil))
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestWsTicketExpiredAndReusedAreRejected(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}
	cookie := guestCookie(t, svc)

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	sessionReq.AddCookie(cookie)
	user, _, ok := svc.UserFromRequest(sessionReq)
	require.True(t, ok)

	mint := httptest.NewRecorder()
	mintReq := httptest.NewRequest(http.MethodPost, "/api/auth/ws-ticket", nil)
	mintReq.AddCookie(cookie)
	svc.HandleWsTicket(mint, mintReq)
	require.Equal(t, http.StatusOK, mint.Code)
	var minted struct {
		Ticket    string `json:"ticket"`
		ExpiresIn int    `json:"expiresIn"`
	}
	require.NoError(t, json.Unmarshal(mint.Body.Bytes(), &minted))
	require.NotEmpty(t, minted.Ticket)
	require.Equal(t, 45, minted.ExpiresIn)
	require.NotContains(t, mint.Body.String(), cookie.Value)

	first := httptest.NewRequest(http.MethodGet, "/ws?ticket="+minted.Ticket, nil)
	_, _, ok = svc.UserFromRequest(first)
	require.True(t, ok)

	reuse := httptest.NewRequest(http.MethodGet, "/ws?ticket="+minted.Ticket, nil)
	_, _, ok = svc.UserFromRequest(reuse)
	require.False(t, ok)

	stillSession := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	stillSession.AddCookie(cookie)
	_, _, ok = svc.UserFromRequest(stillSession)
	require.True(t, ok, "session cookie still authenticates after ticket consume")

	expiredTicket := "expired-ticket"
	require.NoError(t, st.PutWSTicket(expiredTicket, user.ID, -time.Second))
	expiredReq := httptest.NewRequest(http.MethodGet, "/ws?ticket="+expiredTicket, nil)
	_, _, ok = svc.UserFromRequest(expiredReq)
	require.False(t, ok)
}

func TestLogoutInvalidatesOutstandingWsTickets(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}
	cookie := guestCookie(t, svc)

	mint := httptest.NewRecorder()
	mintReq := httptest.NewRequest(http.MethodPost, "/api/auth/ws-ticket", nil)
	mintReq.AddCookie(cookie)
	svc.HandleWsTicket(mint, mintReq)
	require.Equal(t, http.StatusOK, mint.Code)
	var minted struct {
		Ticket string `json:"ticket"`
	}
	require.NoError(t, json.Unmarshal(mint.Body.Bytes(), &minted))

	logout := httptest.NewRecorder()
	logoutReq := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logoutReq.AddCookie(cookie)
	svc.HandleLogout(logout, logoutReq)
	require.Equal(t, http.StatusOK, logout.Code)

	ticketReq := httptest.NewRequest(http.MethodGet, "/ws?ticket="+minted.Ticket, nil)
	_, _, ok := svc.UserFromRequest(ticketReq)
	require.False(t, ok)
}
