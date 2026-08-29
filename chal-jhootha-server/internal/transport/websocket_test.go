package transport_test

import (
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
