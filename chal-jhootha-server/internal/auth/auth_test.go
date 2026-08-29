package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

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
