package transport_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"chal-jhootha-server/internal/auth"
	"chal-jhootha-server/internal/room"
	"chal-jhootha-server/internal/teststore"
	"chal-jhootha-server/internal/transport"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/require"
)

func TestWSRequiresAuth(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}
	rm := room.NewManager(st)
	policy := auth.NewOriginPolicy("http://example.test")
	srv := httptest.NewServer(transport.HandleWebSocket(rm, svc, policy))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx := t.Context()
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://example.test"}}})
	if err == nil {
		_, _, err = conn.Read(ctx)
	}
	require.Error(t, err)
}

func TestWSRejectsUntrustedOrigin(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}
	rm := room.NewManager(st)
	srv := httptest.NewServer(transport.HandleWebSocket(rm, svc, auth.NewOriginPolicy("https://bluff.vercel.app")))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.Dial(t.Context(), wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"https://malicious.example"}},
	})
	if conn != nil {
		defer conn.Close(websocket.StatusNormalClosure, "")
	}
	require.Error(t, err)
}

func TestWSMalformedJSON(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/guest", svc.HandleGuest)
	rm := room.NewManager(st)
	policy := auth.NewOriginPolicy("http://example.test")
	mux.HandleFunc("/ws", transport.HandleWebSocket(rm, svc, policy))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/auth/guest", "application/json", strings.NewReader(`{"name":"T"}`))
	require.NoError(t, err)
	defer resp.Body.Close()
	var cookie string
	for _, c := range resp.Cookies() {
		if c.Name == auth.CookieName {
			cookie = c.Value
		}
	}
	require.NotEmpty(t, cookie)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx := t.Context()
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Cookie": []string{auth.CookieName + "=" + cookie},
			"Origin": []string{"http://example.test"},
		},
	})
	require.NoError(t, err)
	defer conn.Close(websocket.StatusNormalClosure, "")

	require.NoError(t, conn.Write(ctx, websocket.MessageText, []byte(`not-json`)))
	_, msg, err := conn.Read(ctx)
	require.NoError(t, err)
	require.Contains(t, string(msg), "INVALID_PAYLOAD")
	_ = time.Second
}

func mintGuestTicket(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	resp, err := http.Post(srv.URL+"/api/auth/guest", "application/json", strings.NewReader(`{"name":"T"}`))
	require.NoError(t, err)
	defer resp.Body.Close()
	var cookie string
	for _, c := range resp.Cookies() {
		if c.Name == auth.CookieName {
			cookie = c.Value
		}
	}
	require.NotEmpty(t, cookie)

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/auth/ws-ticket", nil)
	require.NoError(t, err)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: cookie})
	ticketResp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer ticketResp.Body.Close()
	require.Equal(t, http.StatusOK, ticketResp.StatusCode)
	var body struct {
		Ticket string `json:"ticket"`
	}
	require.NoError(t, json.NewDecoder(ticketResp.Body).Decode(&body))
	require.NotEmpty(t, body.Ticket)
	return body.Ticket
}

func TestWSTicketConnectsWithoutCookieAndRejectsReuse(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}
	rm := room.NewManager(st)
	policy := auth.NewOriginPolicy("http://example.test")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/guest", svc.HandleGuest)
	mux.HandleFunc("/api/auth/ws-ticket", svc.HandleWsTicket)
	mux.HandleFunc("/ws", transport.HandleWebSocket(rm, svc, policy))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	ticket := mintGuestTicket(t, srv)
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ticket=" + ticket
	ctx := t.Context()
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://example.test"}},
	})
	require.NoError(t, err)
	defer conn.Close(websocket.StatusNormalClosure, "")

	reuse, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://example.test"}},
	})
	if err == nil {
		_, _, err = reuse.Read(ctx)
	}
	require.Error(t, err)
}

func TestWSTicketRejectedWhenOriginMissingAndTicketRemainsUsable(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	svc := &auth.Service{Store: st}
	rm := room.NewManager(st)
	policy := auth.NewOriginPolicy("http://example.test")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/guest", svc.HandleGuest)
	mux.HandleFunc("/api/auth/ws-ticket", svc.HandleWsTicket)
	mux.HandleFunc("/ws", transport.HandleWebSocket(rm, svc, policy))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	ticket := mintGuestTicket(t, srv)
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ticket=" + ticket
	ctx := t.Context()

	missing, _, err := websocket.Dial(ctx, wsURL, nil)
	if missing != nil {
		defer missing.Close(websocket.StatusNormalClosure, "")
	}
	require.Error(t, err)

	wrong, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"https://malicious.example"}},
	})
	if wrong != nil {
		defer wrong.Close(websocket.StatusNormalClosure, "")
	}
	require.Error(t, err)

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://example.test"}},
	})
	require.NoError(t, err)
	defer conn.Close(websocket.StatusNormalClosure, "")
}

func TestClientHub(t *testing.T) {
	ch := make(chan []byte, 1)
	transport.Hub.Register("user-hub-test", "conn1", ch)
	require.True(t, transport.Hub.SendToUser("user-hub-test", []byte("hello")))
	require.Equal(t, "hello", string(<-ch))

	transport.Hub.Unregister("user-hub-test", "conn1")
	require.False(t, transport.Hub.SendToUser("user-hub-test", []byte("hello")))
}
