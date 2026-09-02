package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"chal-jhootha-server/internal/auth"
	"chal-jhootha-server/internal/live"
	"chal-jhootha-server/internal/logger"
	"chal-jhootha-server/internal/metrics"
	"chal-jhootha-server/internal/room"
	"chal-jhootha-server/internal/store"
	"chal-jhootha-server/internal/transport"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "10000"
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	st, err := store.Open(context.Background(), databaseURL)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	liveRuntime, err := live.Open(context.Background(), os.Getenv("REDIS_URL"))
	if err != nil {
		log.Fatalf("open redis runtime: %v", err)
	}
	defer liveRuntime.Close()

	runtimeCtx, stopRuntime := context.WithCancel(context.Background())
	defer stopRuntime()

	rm := room.NewManager(st, liveRuntime)
	authSvc := &auth.Service{Store: st, Runtime: liveRuntime, Rooms: rm, Broadcaster: transport.Hub}
	rm.Restore()
	rm.StartPersistenceWorker(runtimeCtx)
	rm.StartJanitor(runtimeCtx)
	origins := auth.NewOriginPolicy("")
	logger.Info("BOOT", "Server store ready", "database", "postgres")

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(auth.CORS(origins))

	health := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := st.Ping(r.Context()); err != nil || liveRuntime.Ping(r.Context()) != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"unavailable"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}
	r.Get("/api/health", health)
	r.Get("/healthz", health)
	r.Get("/api/metrics", func(w http.ResponseWriter, r *http.Request) {
		metrics.Handler().ServeHTTP(w, r)
	})

	r.Post("/api/auth/register", authSvc.HandleRegister)
	r.Post("/api/auth/login", authSvc.HandleLogin)
	r.Post("/api/auth/guest", authSvc.HandleGuest)
	r.Post("/api/auth/guest/clear", authSvc.HandleClearGuest)
	r.Post("/api/auth/logout", authSvc.HandleLogout)
	r.Post("/api/auth/ws-ticket", authSvc.HandleWsTicket)
	r.Get("/api/auth/session", authSvc.HandleSession)
	r.Get("/api/voice/turn", authSvc.HandleTurnCredentials)
	r.Get("/api/profile/me", authSvc.HandleMyProfile)
	r.Post("/api/profile/me", authSvc.HandleCreateProfile)
	r.Patch("/api/profile/me", authSvc.HandleUpdateProfile)
	r.Post("/api/profile/me/password", authSvc.HandleUpdatePassword)
	r.Get("/api/profiles/{handle}", authSvc.HandlePublicProfile)
	r.Get("/api/friends", authSvc.HandleFriendships)
	r.Post("/api/friends/requests", authSvc.HandleCreateFriendRequest)
	r.Post("/api/friends/requests/{id}/accept", authSvc.HandleFriendResponse(true))
	r.Post("/api/friends/requests/{id}/decline", authSvc.HandleFriendResponse(false))
	r.Delete("/api/friends/{id}", authSvc.HandleRemoveFriendship)
	r.Get("/api/room-invites", authSvc.HandleRoomInvites)
	r.Post("/api/room-invites", authSvc.HandleCreateRoomInvite)
	r.Post("/api/room-invites/{token}/accept", authSvc.HandleRoomInviteResponse(true))
	r.Post("/api/room-invites/{token}/decline", authSvc.HandleRoomInviteResponse(false))
	r.Get("/api/players/recent", authSvc.HandleRecentPlayers)

	r.HandleFunc("/ws", transport.HandleWebSocket(rm, authSvc, origins))

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Printf("Starting Go server on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	stopRuntime()
	if err := rm.WaitForPersistenceWorker(ctx); err != nil {
		logger.Error("PERSIST", "Persistence worker did not stop cleanly", "error", err)
	}
	if err := rm.FlushPersistence(ctx); err != nil {
		logger.Error("PERSIST", "Graceful persistence flush timed out", "error", err)
	}
}
