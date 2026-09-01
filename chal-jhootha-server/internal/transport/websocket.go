package transport

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"golang.org/x/time/rate"

	"chal-jhootha-server/internal/auth"
	"chal-jhootha-server/internal/logger"
	"chal-jhootha-server/internal/metrics"
	"chal-jhootha-server/internal/room"
	"chal-jhootha-server/internal/ws"
)

var validate = validator.New()

type session struct {
	ConnID           string
	UserID           string
	IsEphemeralGuest bool
	PlayerID         string
	RoomCode         string
	Joined           bool
	Outbound         chan []byte
}

func HandleWebSocket(rm *room.Manager, authSvc *auth.Service, origins *auth.OriginPolicy) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !origins.IsAllowed(r.Header.Get("Origin")) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		connStart := time.Now()
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
			Subprotocols:       []string{"cj-v1"},
		})
		if err != nil {
			logger.Error("WS", "WebSocket handshake accept failed", "error", err, "ip", r.RemoteAddr)
			return
		}

		authStarted := time.Now()
		user, _, ok := authSvc.UserFromRequest(r)
		metrics.Observe("ws_auth", time.Since(authStarted))
		if !ok {
			_ = c.Close(websocket.StatusPolicyViolation, "authentication required")
			logger.Warn("WS", "Unauthenticated websocket rejected", "ip", r.RemoteAddr)
			return
		}

		connID := uuid.New().String()
		activeConns := logger.IncActiveConnections()
		logger.WSConnect(connID, r.RemoteAddr, r.UserAgent(), activeConns)
		logger.Info("WS", "Authenticated connection", "conn", connID, "userId", user.ID)
		authSvc.MarkOnline(r.Context(), user)

		sess := &session{
			ConnID:           connID,
			UserID:           user.ID,
			IsEphemeralGuest: user.IsEphemeralGuest,
			Outbound:         make(chan []byte, 128),
		}

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		c.SetReadLimit(65536)

		go func() {
			defer c.Close(websocket.StatusInternalError, "internal error")
			for {
				select {
				case <-ctx.Done():
					return
				case msg, ok := <-sess.Outbound:
					if !ok {
						c.Close(websocket.StatusNormalClosure, "session ended")
						return
					}
					writeCtx, writeCancel := context.WithTimeout(ctx, 3*time.Second)
					err := c.Write(writeCtx, websocket.MessageText, msg)
					writeCancel()
					if err != nil {
						return
					}
				}
			}
		}()

		disconnectReason := "normal"
		defer func() {
			duration := time.Since(connStart)
			remainingConns := logger.DecActiveConnections()
			if sess.Joined && sess.RoomCode != "" && sess.PlayerID != "" {
				if targetRoom, ok := rm.GetRoom(sess.RoomCode); ok {
					select {
					case targetRoom.Inbox <- room.RoomMessage{
						ConnectionID: sess.ConnID,
						PlayerID:     sess.PlayerID,
						Event:        room.InternalLeaveEvent{ConnectionID: sess.ConnID},
					}:
					case <-time.After(100 * time.Millisecond):
					}
				}
			}
			logger.WSDisconnect(sess.ConnID, sess.RoomCode, sess.PlayerID, disconnectReason, duration, remainingConns)
			cancel()
		}()

		limiter := rate.NewLimiter(30, 60)

		for {
			readCtx, readCancel := context.WithTimeout(ctx, 45*time.Second)
			_, msgBytes, err := c.Read(readCtx)
			readCancel()
			if err != nil {
				if errors.Is(err, context.DeadlineExceeded) {
					disconnectReason = "heartbeat_timeout_45s"
				} else if websocket.CloseStatus(err) == websocket.StatusNormalClosure || websocket.CloseStatus(err) == websocket.StatusGoingAway {
					disconnectReason = "client_closed"
				} else {
					disconnectReason = err.Error()
				}
				break
			}

			if !limiter.Allow() {
				sess.sendError("", "RATE_LIMITED", "Too many requests")
				continue
			}

			var base ws.BaseClientEvent
			if err := json.Unmarshal(msgBytes, &base); err != nil {
				logger.Warn("WS", "Malformed JSON payload received", "conn", sess.ConnID, "error", err)
				sess.sendError("", "INVALID_PAYLOAD", "Invalid JSON payload")
				continue
			}
			if err := validate.Struct(base); err != nil {
				sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Validation failed")
				continue
			}
			if base.ProtocolVersion != "" && base.ProtocolVersion != "1.0.0" && base.ProtocolVersion != "2.0.0" {
				sess.sendError(base.ClientMsgID, "VERSION_MISMATCH", "Unsupported protocol version")
				continue
			}

			logger.EventReceived(sess.ConnID, sess.RoomCode, sess.PlayerID, base.Type, base.ClientMsgID, len(msgBytes))
			metrics.WebSocketInbound(len(msgBytes))

			switch base.Type {
			case "create_room":
				if sess.Joined {
					sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Already joined a room")
					continue
				}
				var ev ws.CreateRoomEvent
				if err := json.Unmarshal(msgBytes, &ev); err != nil {
					sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Invalid payload")
					continue
				}
				if err := validate.Struct(ev); err != nil {
					sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Validation failed")
					continue
				}
				roomCode := generateRoomCode(rm)
				sess.RoomCode = roomCode
				rmRoom := rm.GetOrCreateRoom(roomCode)
				name := ev.PlayerName
				if name == "" {
					name = user.DisplayName
				}
				replyChan := make(chan string, 1)
				rmRoom.Inbox <- room.RoomMessage{
					ConnectionID: sess.ConnID,
					Event: room.InternalJoinEvent{
						ClientMsgID:  base.ClientMsgID,
						PlayerName:   name,
						UserID:       sess.UserID,
						AvatarID:     user.AvatarID,
						DeckCount:    ev.DeckCount,
						WinnerCount:  ev.WinnerCount,
						ConnectionID: sess.ConnID,
						Outbound:     sess.Outbound,
						ReplyChan:    replyChan,
					},
				}
				select {
				case sess.PlayerID = <-replyChan:
					if sess.PlayerID != "" {
						sess.Joined = true
						if !sess.IsEphemeralGuest {
							rm.TrackUserRoom(sess.UserID, roomCode)
						}
						logger.Info("ROOM", "Room created", "room", roomCode, "player", sess.PlayerID)
					}
				case <-time.After(3 * time.Second):
					sess.sendError(base.ClientMsgID, "INTERNAL_ERROR", "Room creation timed out")
				}

			case "join_room":
				if sess.Joined {
					sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Already joined a room")
					continue
				}
				var ev ws.JoinRoomEvent
				if err := json.Unmarshal(msgBytes, &ev); err != nil {
					sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Invalid payload")
					continue
				}
				if err := validate.Struct(ev); err != nil {
					sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Validation failed")
					continue
				}
				if ev.RoomCode == "" {
					sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Missing room code")
					continue
				}
				rmRoom, exists := rm.GetRoom(ev.RoomCode)
				if !exists {
					sess.sendError(base.ClientMsgID, "ROOM_NOT_FOUND", "Room does not exist")
					continue
				}
				sess.RoomCode = ev.RoomCode
				name := ev.PlayerName
				if name == "" {
					name = user.DisplayName
				}
				replyChan := make(chan string, 1)
				rmRoom.Inbox <- room.RoomMessage{
					ConnectionID: sess.ConnID,
					Event: room.InternalJoinEvent{
						ClientMsgID:  base.ClientMsgID,
						PlayerName:   name,
						UserID:       sess.UserID,
						AvatarID:     user.AvatarID,
						RejoinToken:  ev.RejoinToken,
						ConnectionID: sess.ConnID,
						Outbound:     sess.Outbound,
						ReplyChan:    replyChan,
					},
				}
				select {
				case sess.PlayerID = <-replyChan:
					if sess.PlayerID != "" {
						sess.Joined = true
						if !sess.IsEphemeralGuest {
							rm.TrackUserRoom(sess.UserID, ev.RoomCode)
						}
					} else {
						sess.RoomCode = ""
					}
				case <-time.After(3 * time.Second):
					sess.sendError(base.ClientMsgID, "INTERNAL_ERROR", "Join timed out")
				}

			case "start_game":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.StartGameEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "set_config":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.SetConfigEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "play_cards":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.PlayCardsEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "challenge":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.ChallengeEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "skip":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.SkipEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "sync_state":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.SyncStateEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "voice_signal":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.VoiceSignalEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "reaction":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.ReactionEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "reset_to_lobby":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.ResetToLobbyEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "return_to_lobby":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.ReturnToLobbyEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "leave_room":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.LeaveRoomEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "destroy_room":
				sess.forwardToRoom(rm, base.ClientMsgID, msgBytes, func() any {
					var ev ws.DestroyRoomEvent
					_ = json.Unmarshal(msgBytes, &ev)
					return &ev
				})
			case "heartbeat":
				authSvc.MarkOnline(ctx, user)
			default:
				sess.sendError(base.ClientMsgID, "INVALID_PAYLOAD", "Unknown event type")
			}
		}
	}
}

func (s *session) sendError(clientMsgID, code, msg string) {
	errEv := ws.ErrorEvent{Type: "error", Code: code, Message: msg}
	if clientMsgID != "" {
		errEv.ClientMsgID = &clientMsgID
	}
	b, _ := json.Marshal(errEv)
	select {
	case s.Outbound <- b:
	default:
	}
}

func (s *session) forwardToRoom(rm *room.Manager, clientMsgID string, msgBytes []byte, parse func() any) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	available := rm.RuntimeHealthy(ctx)
	cancel()
	if !available {
		s.sendError(clientMsgID, "RUNTIME_UNAVAILABLE", "Live game service is temporarily unavailable. Please try again.")
		return
	}
	if !s.Joined || s.RoomCode == "" || s.PlayerID == "" {
		s.sendError(clientMsgID, "UNAUTHORIZED", "Not joined to a room")
		return
	}
	rmRoom, ok := rm.GetRoom(s.RoomCode)
	if !ok {
		s.sendError(clientMsgID, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	ev := parse()
	if err := validate.Struct(ev); err != nil {
		s.sendError(clientMsgID, "INVALID_PAYLOAD", "Validation failed")
		return
	}
	select {
	case rmRoom.Inbox <- room.RoomMessage{
		ConnectionID: s.ConnID,
		PlayerID:     s.PlayerID,
		ClientMsg:    clientMsgID,
		Event:        ev,
	}:
	default:
		s.sendError(clientMsgID, "SERVER_BUSY", "Server is busy, try again")
	}
}

func generateRoomCode(rm *room.Manager) string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		b := make([]byte, 4)
		_, _ = cryptorand.Read(b)
		for i := 0; i < 4; i++ {
			b[i] = charset[int(b[i])%len(charset)]
		}
		code := string(b)
		if !rm.HasRoom(code) {
			return code
		}
	}
}
