package room

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"time"

	"chal-jhootha-server/internal/logger"
	"chal-jhootha-server/internal/metrics"
	"chal-jhootha-server/internal/rules"
	"chal-jhootha-server/internal/store"
	"chal-jhootha-server/internal/ws"

	"github.com/google/uuid"
)

var (
	DisconnectedTurnGrace  = 10 * time.Second
	DisconnectAbandonAfter = 5 * time.Minute
)

const (
	MaxVoiceParticipants   = 8
	defaultRoomIdleTTL     = 24 * time.Hour
)



type RoomMessage struct {
	ConnectionID string
	PlayerID     string
	Event        any
	ClientMsg    string
}

type snapshotRequest struct {
	reply chan snapshotResult
}

type snapshotResult struct {
	raw []byte
	err error
}

type connectionState struct {
	ConnID   string
	PlayerID string
	Outbound chan []byte
}

// disconnectLifecycle is private room state. It carries the original
// disconnect time across a server restart so an outage never grants a player
// a fresh abandonment window.
type disconnectLifecycle struct {
	DisconnectedAtUnixNano  int64 `json:"disconnectedAtUnixNano"`
	AbandonDeadlineUnixNano int64 `json:"abandonDeadlineUnixNano"`
}

// turnGrace is private actor state for a disconnected player's current turn.
// Generation makes delayed callbacks harmless once a turn has moved on.
type turnGrace struct {
	PlayerID         string `json:"playerId"`
	Generation       uint64 `json:"generation"`
	DeadlineUnixNano int64  `json:"deadlineUnixNano"`
}

type Room struct {
	Code     string
	State    ws.GameState
	Inbox    chan RoomMessage
	CloseReq chan struct{}

	playerHands              map[string][]ws.Card
	stack                    []ws.Card
	rejoinTokens             map[string]string
	connections              map[string]connectionState // connID ->
	controllerConn           map[string]string          // playerID -> connID
	seq                      int
	startedAt                *time.Time
	matchID                  string
	lastActivity             time.Time
	idleTTL                  time.Duration
	tracker                  *IdempotencyTracker
	disconnects              map[string]disconnectLifecycle
	turnGeneration           uint64
	turnGrace                *turnGrace
	turnGraceTimer           *time.Timer
	abandonTimers            map[string]*time.Timer
	resultsLobby             map[string]bool
	consecutiveSkipPlayerIDs []string
	voiceMembers             map[string]bool
	lastReactionAt           map[string]time.Time
	persistFn                func(*Room)
	recordMatchFn            func(matchID, roomCode string, participants []store.MatchParticipant) error
	destroyFn                func(string)
	clearUserRoomFn          func(string)
	actionLease              func(string, func() error) error
	leaseHeld                bool
	activeClientMsg          string

	ctx    context.Context
	cancel context.CancelFunc
}

func NewRoom(code string, persistFn func(*Room)) *Room {
	return newRoom(code, persistFn, true)
}

func newRoom(code string, persistFn func(*Room), start bool) *Room {
	ctx, cancel := context.WithCancel(context.Background())
	r := &Room{
		Code: code,
		State: ws.GameState{
			RoomCode:    code,
			Phase:       ws.PhaseLobby,
			Players:     []ws.Player{},
			StackCount:  0,
			DeckCount:   1,
			WinnerCount: 1,
			Winners:     []string{},
		},
		Inbox:                    make(chan RoomMessage, 128),
		CloseReq:                 make(chan struct{}),
		playerHands:              make(map[string][]ws.Card),
		stack:                    make([]ws.Card, 0),
		rejoinTokens:             make(map[string]string),
		connections:              make(map[string]connectionState),
		controllerConn:           make(map[string]string),
		seq:                      1,
		lastActivity:             time.Now(),
		idleTTL:                  defaultRoomIdleTTL,
		tracker:                  NewIdempotencyTracker(256),
		disconnects:              make(map[string]disconnectLifecycle),
		abandonTimers:            make(map[string]*time.Timer),
		resultsLobby:             make(map[string]bool),
		consecutiveSkipPlayerIDs: []string{},
		voiceMembers:             make(map[string]bool),
		lastReactionAt:           make(map[string]time.Time),
		persistFn:                persistFn,
		ctx:                      ctx,
		cancel:                   cancel,
	}
	if start {
		r.startActor()
	}
	return r
}

func (r *Room) startActor() {
	go r.Run()
}

func (r *Room) persist() {
	if r.persistFn != nil {
		r.persistFn(r)
	}
}

// Snapshot obtains a durable room snapshot through the room actor. It is the
// safe public read path for callers outside the actor goroutine.
func (r *Room) Snapshot(ctx context.Context) ([]byte, error) {
	reply := make(chan snapshotResult, 1)
	request := RoomMessage{Event: snapshotRequest{reply: reply}}
	select {
	case r.Inbox <- request:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-r.ctx.Done():
		return nil, context.Canceled
	}
	select {
	case result := <-reply:
		return result.raw, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-r.ctx.Done():
		return nil, context.Canceled
	}
}

func (r *Room) SetMatchRecorder(fn func(matchID, roomCode string, participants []store.MatchParticipant) error) {
	r.recordMatchFn = fn
}

// SetDestroyHandler is owned by Manager. It is called asynchronously after a
// final room event is delivered so an explicit departure never behaves like a
// transient socket loss.
func (r *Room) SetDestroyHandler(fn func(string)) {
	r.destroyFn = fn
}

func (r *Room) SetUserRoomClearer(fn func(string)) {
	r.clearUserRoomFn = fn
}

func (r *Room) SetActionLease(fn func(string, func() error) error) {
	r.actionLease = fn
}

func (r *Room) Run() {
	logger.Debug("ROOM", "Room actor goroutine started", "room", r.Code)
	defer func() {
		r.stopLifecycleTimers()
		r.cancel()
		logger.Debug("ROOM", "Room actor goroutine stopped", "room", r.Code)
	}()
	for {
		select {
		case msg := <-r.Inbox:
			r.lastActivity = time.Now()
			r.processMessage(msg)
		case <-r.CloseReq:
			return
		case <-r.ctx.Done():
			return
		}
	}
}

func (r *Room) ShouldExpire(now time.Time) bool {
	return now.Sub(r.lastActivity) > r.idleTTL
}

func (r *Room) SetIdleTTL(ttl time.Duration) {
	if ttl > 0 {
		r.idleTTL = ttl
	}
}

func (r *Room) replayDuplicate(playerID, connID, clientMsgID string) bool {
	if clientMsgID == "" {
		return false
	}
	seq, ok := r.tracker.Has(clientMsgID)
	if !ok {
		return false
	}
	logger.Debug("IDEMPOTENCY", "Duplicate clientMsgId, replaying ack", "room", r.Code, "msgId", clientMsgID, "seq", seq)
	if r.activeClientMsg == "" {
		// Direct actor callers from the original protocol still receive the
		// legacy acknowledgement. WebSocket clients receive action_accepted.
		r.sendToConn(connID, ws.AckEvent{Type: "ack", ClientMsgID: clientMsgID, AppliedSeq: seq})
	} else {
		r.sendToConn(connID, ws.ActionAcceptedEvent{Type: "action_accepted", ClientMsgID: clientMsgID, AppliedSeq: seq})
	}
	r.sendSnapshotToPlayer(playerID)
	return true
}

func (r *Room) commitAction(playerID, connID, clientMsgID string) {
	r.tracker.Add(clientMsgID, r.seq)
	r.persist()
	if clientMsgID != "" && connID != "" {
		r.sendToConn(connID, ws.ActionAcceptedEvent{Type: "action_accepted", ClientMsgID: clientMsgID, AppliedSeq: r.seq})
	}
}

func (r *Room) processMessage(msg RoomMessage) {
	// Commands received from a WebSocket carry a client message ID. Guard them
	// with Redis' short per-room lease before touching actor state; timers and
	// internal joins remain local actor operations.
	if msg.ClientMsg != "" && r.actionLease != nil && !r.leaseHeld {
		r.leaseHeld = true
		err := r.actionLease(r.Code, func() error {
			r.processMessage(msg)
			return nil
		})
		r.leaseHeld = false
		if err != nil {
			r.activeClientMsg = msg.ClientMsg
			r.reject(msg.PlayerID, msg.ConnectionID, "ROOM_BUSY", "Another room action is being applied. Try again.")
			r.activeClientMsg = ""
		}
		return
	}
	r.activeClientMsg = msg.ClientMsg
	defer func() { r.activeClientMsg = "" }()
	start := time.Now()
	switch ev := msg.Event.(type) {
	case *ws.StartGameEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handleStartGame(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "start_game", r.seq, time.Since(start))
	case *ws.SetConfigEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handleSetConfig(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "set_config", r.seq, time.Since(start))
	case *ws.PlayCardsEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handlePlayCards(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "play_cards", r.seq, time.Since(start))
	case *ws.ChallengeEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handleChallenge(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "challenge", r.seq, time.Since(start))
	case *ws.SkipEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handleSkip(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "skip", r.seq, time.Since(start))
	case *ws.SyncStateEvent:
		r.sendSnapshotToPlayer(msg.PlayerID)
		logger.EventProcessed(r.Code, msg.PlayerID, "sync_state", r.seq, time.Since(start))
	case *ws.ResetToLobbyEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handleResetToLobby(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "reset_to_lobby", r.seq, time.Since(start))
	case *ws.ReturnToLobbyEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handleReturnToLobby(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "return_to_lobby", r.seq, time.Since(start))
	case *ws.LeaveRoomEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handleLeaveRoom(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "leave_room", r.seq, time.Since(start))
	case *ws.DestroyRoomEvent:
		if r.replayDuplicate(msg.PlayerID, msg.ConnectionID, ev.ClientMsgID) {
			return
		}
		r.handleDestroyRoom(msg.PlayerID, msg.ConnectionID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "destroy_room", r.seq, time.Since(start))
	case *ws.VoiceSignalEvent:
		r.handleVoice(msg.PlayerID, msg.ConnectionID, ev)
	case *ws.ReactionEvent:
		r.handleReaction(msg.PlayerID, msg.ConnectionID, ev)
	case InternalJoinEvent:
		r.handleInternalJoin(ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "internal_join", r.seq, time.Since(start))
	case InternalLeaveEvent:
		r.handleInternalLeave(msg.PlayerID, ev)
		logger.EventProcessed(r.Code, msg.PlayerID, "internal_leave", r.seq, time.Since(start))
	case TurnGraceExpiredEvent:
		r.handleTurnGraceExpired(ev)
	case AbandonEvent:
		r.handleAbandon(ev)
	case snapshotRequest:
		raw, err := r.marshalSnapshot()
		select {
		case ev.reply <- snapshotResult{raw: raw, err: err}:
		default:
		}
	case lobbyHostQuery:
		select {
		case ev.reply <- r.State.Phase == ws.PhaseLobby && r.State.HostID == ev.playerID:
		default:
		}
	}
}

func (r *Room) playerRole(playerID string) ws.PlayerRole {
	for _, p := range r.State.Players {
		if p.ID == playerID {
			if p.Role != "" {
				return p.Role
			}
			if p.IsWinner {
				return ws.RoleWinnerSpectator
			}
			if p.IsAbandoned {
				return ws.RoleAbandoned
			}
			return ws.RoleActive
		}
	}
	return ws.RoleSpectator
}

func (r *Room) sendToConn(connID string, event any) {
	st, ok := r.connections[connID]
	if !ok {
		return
	}
	b, err := json.Marshal(event)
	if err != nil {
		return
	}
	metrics.WebSocketOutbound(len(b))
	select {
	case st.Outbound <- b:
	default:
		logger.ChannelOverflow(r.Code, st.PlayerID, "direct_send", len(st.Outbound))
	}
}

func (r *Room) sendToPlayer(playerID string, event any) {
	b, err := json.Marshal(event)
	if err != nil {
		return
	}
	for _, st := range r.connections {
		if st.PlayerID != playerID {
			continue
		}
		select {
		case st.Outbound <- b:
			metrics.WebSocketOutbound(len(b))
		default:
			logger.ChannelOverflow(r.Code, playerID, "player_send", len(st.Outbound))
		}
	}
}

func (r *Room) sendToOutbound(out chan []byte, event any) {
	b, err := json.Marshal(event)
	if err != nil {
		return
	}
	metrics.WebSocketOutbound(len(b))
	select {
	case out <- b:
	default:
		logger.ChannelOverflow(r.Code, "unknown", "outbound_send", len(out))
	}
}

func (r *Room) broadcast(event any) {
	b, err := json.Marshal(event)
	if err != nil {
		return
	}
	for pID, st := range r.connections {
		select {
		case st.Outbound <- b:
			metrics.WebSocketOutbound(len(b))
		default:
			logger.ChannelOverflow(r.Code, pID, "broadcast", len(st.Outbound))
		}
	}
}

func (r *Room) publicPlayers() []ws.Player {
	out := make([]ws.Player, len(r.State.Players))
	copy(out, r.State.Players)
	return out
}

func (r *Room) resultsLobbyPlayerIDs() []string {
	ids := make([]string, 0, len(r.resultsLobby))
	for _, player := range r.State.Players {
		if r.resultsLobby[player.ID] {
			ids = append(ids, player.ID)
		}
	}
	return ids
}

func (r *Room) roomStateEvent() ws.RoomStateEvent {
	return ws.RoomStateEvent{
		Type:              "room_state",
		Seq:               r.seq,
		Players:           r.publicPlayers(),
		HostID:            r.State.HostID,
		Phase:             r.State.Phase,
		DeckCount:         r.State.DeckCount,
		WinnerCount:       r.State.WinnerCount,
		WinnerCountLocked: r.State.WinnerCountLocked,
		LastMatch:         r.State.LastMatch,
	}
}

func (r *Room) broadcastRoomState() {
	r.broadcast(r.roomStateEvent())
}

func (r *Room) gameStateEventFor(playerID, connID string) ws.GameStateEvent {
	hands := make(map[string]int)
	for _, p := range r.State.Players {
		hands[p.ID] = p.HandCount
	}
	controller := r.controllerConn[playerID] == connID
	if connID == "" {
		controller = r.controllerConn[playerID] != ""
	}
	return ws.GameStateEvent{
		Type:                  "game_state",
		Seq:                   r.seq,
		Phase:                 r.State.Phase,
		Players:               r.publicPlayers(),
		HostID:                r.State.HostID,
		Hands:                 hands,
		YourHand:              r.playerHands[playerID],
		StackCount:            r.State.StackCount,
		ClaimedRank:           r.State.ClaimedRank,
		CurrentTurnPlayerID:   r.State.CurrentTurnPlayerID,
		RoundOpenerID:         r.State.RoundOpenerID,
		LastAction:            r.State.LastAction,
		TopPlay:               r.State.TopPlay,
		Winners:               r.State.Winners,
		DeckCount:             r.State.DeckCount,
		WinnerCount:           r.State.WinnerCount,
		WinnerCountLocked:     r.State.WinnerCountLocked,
		PendingFinishID:       r.State.PendingFinishID,
		ResultsLobbyPlayerIDs: r.resultsLobbyPlayerIDs(),
		YouAreController:      controller,
		YourRole:              r.playerRole(playerID),
		LastMatch:             r.State.LastMatch,
	}
}

func (r *Room) broadcastGameState() {
	for _, st := range r.connections {
		ev := r.gameStateEventFor(st.PlayerID, st.ConnID)
		r.sendToConn(st.ConnID, ev)
	}
}

func (r *Room) sendSnapshotToPlayer(playerID string) {
	r.sendToPlayer(playerID, r.roomStateEvent())
	for _, st := range r.connections {
		if st.PlayerID == playerID {
			r.sendToConn(st.ConnID, r.gameStateEventFor(playerID, st.ConnID))
		}
	}
}

func (r *Room) reject(playerID, connID, code, msg string) {
	ev := ws.ErrorEvent{Type: "error", Code: code, Message: msg}
	if r.activeClientMsg != "" {
		ev.ClientMsgID = &r.activeClientMsg
		rejection := ws.ActionRejectedEvent{Type: "action_rejected", ClientMsgID: r.activeClientMsg, Code: code, Message: msg}
		if connID != "" {
			r.sendToConn(connID, rejection)
		} else {
			r.sendToPlayer(playerID, rejection)
		}
	}
	if connID != "" {
		r.sendToConn(connID, ev)
		return
	}
	r.sendToPlayer(playerID, ev)
}

func (r *Room) isController(playerID, connID string) bool {
	if connID == "" {
		return true // internal timers
	}
	return r.controllerConn[playerID] == connID
}

func (r *Room) canAct(playerID, connID string) bool {
	if !r.isController(playerID, connID) {
		r.reject(playerID, connID, "NOT_ACTIVE_CONTROLLER", "This device is not the active controller")
		return false
	}
	for _, p := range r.State.Players {
		if p.ID == playerID {
			if p.IsWinner {
				r.reject(playerID, connID, "UNAUTHORIZED", "Finished players cannot act")
				return false
			}
			if p.IsAbandoned {
				r.reject(playerID, connID, "UNAUTHORIZED", "Abandoned players cannot act")
				return false
			}
			return true
		}
	}
	r.reject(playerID, connID, "UNAUTHORIZED", "Not a player in this room")
	return false
}

func (r *Room) requireHostController(playerID, connID string) bool {
	if !r.isController(playerID, connID) {
		r.reject(playerID, connID, "NOT_ACTIVE_CONTROLLER", "This device is not the active controller")
		return false
	}
	index := r.playerIndex(playerID)
	if index == -1 {
		r.reject(playerID, connID, "UNAUTHORIZED", "Not a player in this room")
		return false
	}
	player := r.State.Players[index]
	if player.IsAbandoned {
		r.reject(playerID, connID, "UNAUTHORIZED", "Abandoned players cannot act")
		return false
	}
	if player.IsWinner && r.State.Phase != ws.PhaseFinished {
		r.reject(playerID, connID, "UNAUTHORIZED", "Finished players cannot act")
		return false
	}
	if r.State.HostID != playerID {
		r.reject(playerID, connID, "NOT_HOST", "Only host can perform this action")
		return false
	}
	return true
}

func (r *Room) canReturnToLobby(playerID, connID string) bool {
	if !r.isController(playerID, connID) {
		r.reject(playerID, connID, "NOT_ACTIVE_CONTROLLER", "This device is not the active controller")
		return false
	}
	if r.playerIndex(playerID) == -1 {
		r.reject(playerID, connID, "UNAUTHORIZED", "Not a player in this room")
		return false
	}
	if r.State.Phase != ws.PhaseFinished {
		r.reject(playerID, connID, "MATCH_NOT_FINISHED", "Return to lobby is available after the match ends")
		return false
	}
	return true
}

func (r *Room) resultsLobbyReady() bool {
	for _, player := range r.State.Players {
		if player.IsDisconnected || player.IsAbandoned {
			continue
		}
		if !r.resultsLobby[player.ID] {
			return false
		}
	}
	return true
}

func (r *Room) now() time.Time {
	return time.Now()
}

func (r *Room) playerIndex(playerID string) int {
	for i, player := range r.State.Players {
		if player.ID == playerID {
			return i
		}
	}
	return -1
}

func (r *Room) stopTurnGrace() {
	if r.turnGraceTimer != nil {
		r.turnGraceTimer.Stop()
		r.turnGraceTimer = nil
	}
	r.turnGrace = nil
}

func (r *Room) stopAbandonTimer(playerID string) {
	if timer, ok := r.abandonTimers[playerID]; ok {
		timer.Stop()
		delete(r.abandonTimers, playerID)
	}
}

func (r *Room) stopLifecycleTimers() {
	r.stopTurnGrace()
	for playerID := range r.abandonTimers {
		r.stopAbandonTimer(playerID)
	}
}

func (r *Room) startAbandonTimer(playerID string, deadlineUnixNano int64) {
	r.stopAbandonTimer(playerID)
	delay := time.Unix(0, deadlineUnixNano).Sub(r.now())
	event := AbandonEvent{PlayerID: playerID, DeadlineUnixNano: deadlineUnixNano}
	if delay <= 0 {
		select {
		case r.Inbox <- RoomMessage{PlayerID: playerID, Event: event}:
		default:
		}
		return
	}
	r.abandonTimers[playerID] = time.AfterFunc(delay, func() {
		select {
		case r.Inbox <- RoomMessage{PlayerID: playerID, Event: event}:
		case <-r.ctx.Done():
		}
	})
}

func (r *Room) startTurnGraceForCurrentTurn() {
	r.stopTurnGrace()
	if r.State.Phase != ws.PhasePlaying || r.State.CurrentTurnPlayerID == nil {
		return
	}
	playerID := *r.State.CurrentTurnPlayerID
	index := r.playerIndex(playerID)
	if index == -1 || !r.State.Players[index].IsDisconnected || r.State.Players[index].IsAbandoned {
		return
	}
	grace := &turnGrace{
		PlayerID:         playerID,
		Generation:       r.turnGeneration,
		DeadlineUnixNano: r.now().Add(DisconnectedTurnGrace).UnixNano(),
	}
	r.turnGrace = grace
	r.scheduleTurnGrace(grace)
}

func (r *Room) scheduleTurnGrace(grace *turnGrace) {
	if grace == nil {
		return
	}
	delay := time.Unix(0, grace.DeadlineUnixNano).Sub(r.now())
	event := TurnGraceExpiredEvent{PlayerID: grace.PlayerID, Generation: grace.Generation, DeadlineUnixNano: grace.DeadlineUnixNano}
	if delay <= 0 {
		select {
		case r.Inbox <- RoomMessage{PlayerID: grace.PlayerID, Event: event}:
		default:
		}
		return
	}
	r.turnGraceTimer = time.AfterFunc(delay, func() {
		select {
		case r.Inbox <- RoomMessage{PlayerID: grace.PlayerID, Event: event}:
		case <-r.ctx.Done():
		}
	})
}

// setCurrentTurn is the sole actor path for assigning a turn. It also makes
// the reconnect grace follow the turn instead of the earlier disconnect.
func (r *Room) setCurrentTurn(playerID string) {
	r.stopTurnGrace()
	r.turnGeneration++
	if playerID == "" {
		r.State.CurrentTurnPlayerID = nil
		return
	}
	r.State.CurrentTurnPlayerID = &playerID
	r.startTurnGraceForCurrentTurn()
}

func (r *Room) markDisconnected(playerID string) {
	index := r.playerIndex(playerID)
	if index == -1 {
		return
	}
	r.State.Players[index].IsDisconnected = true
	if r.State.Players[index].IsAbandoned {
		return
	}
	if r.State.Phase != ws.PhasePlaying || r.State.Players[index].IsWinner {
		return
	}
	if _, alreadyTracked := r.disconnects[playerID]; !alreadyTracked {
		now := r.now()
		lifecycle := disconnectLifecycle{
			DisconnectedAtUnixNano:  now.UnixNano(),
			AbandonDeadlineUnixNano: now.Add(DisconnectAbandonAfter).UnixNano(),
		}
		r.disconnects[playerID] = lifecycle
		r.startAbandonTimer(playerID, lifecycle.AbandonDeadlineUnixNano)
	}
	if r.State.CurrentTurnPlayerID != nil && *r.State.CurrentTurnPlayerID == playerID {
		r.startTurnGraceForCurrentTurn()
	}
}

func (r *Room) markReconnected(playerID string) {
	index := r.playerIndex(playerID)
	if index == -1 {
		return
	}
	r.State.Players[index].IsDisconnected = false
	if r.turnGrace != nil && r.turnGrace.PlayerID == playerID {
		r.stopTurnGrace()
	}
	r.stopAbandonTimer(playerID)
	delete(r.disconnects, playerID)
}

func (r *Room) setPendingFinish(playerID string) {
	r.State.PendingFinishID = &playerID
}

func (r *Room) clearPendingFinish() {
	r.State.PendingFinishID = nil
}

func (r *Room) resetSkipProgression() {
	r.consecutiveSkipPlayerIDs = []string{}
}

func (r *Room) recordSkip(playerID string) {
	for _, id := range r.consecutiveSkipPlayerIDs {
		if id == playerID {
			return
		}
	}
	r.consecutiveSkipPlayerIDs = append(r.consecutiveSkipPlayerIDs, playerID)
}

func (r *Room) pendingFinishIsTopPlay() bool {
	return r.State.PendingFinishID != nil && r.State.TopPlay != nil && *r.State.PendingFinishID == r.State.TopPlay.PlayerID
}

func (r *Room) skipRequirementsMet() bool {
	if r.State.TopPlay == nil || r.State.StackCount == 0 {
		return false
	}
	pendingTop := r.pendingFinishIsTopPlay()
	seen := make(map[string]struct{}, len(r.consecutiveSkipPlayerIDs))
	for _, id := range r.consecutiveSkipPlayerIDs {
		seen[id] = struct{}{}
	}
	required := 0
	for _, player := range r.State.Players {
		if pendingTop {
			if !rules.IsInRotation(player, r.State.PendingFinishID) {
				continue
			}
		} else if player.IsWinner || player.IsAbandoned {
			continue
		}
		required++
		if _, ok := seen[player.ID]; !ok {
			return false
		}
	}
	return required > 0
}

func (r *Room) lastSkipperID(fallback string) string {
	if n := len(r.consecutiveSkipPlayerIDs); n > 0 {
		return r.consecutiveSkipPlayerIDs[n-1]
	}
	return fallback
}

func (r *Room) clearRound() {
	r.stack = []ws.Card{}
	r.State.StackCount = 0
	r.State.ClaimedRank = nil
	r.State.TopPlay = nil
	r.resetSkipProgression()
}

func (r *Room) startClearedRound(starterID string) {
	r.clearRound()
	if r.State.Phase != ws.PhasePlaying {
		return
	}
	r.setCurrentTurn(starterID)
	r.State.RoundOpenerID = &starterID
}

func (r *Room) resolveAllPass(fallbackSkipper string) {
	if r.pendingFinishIsTopPlay() {
		r.confirmPendingFinish()
	}
	if r.State.Phase != ws.PhasePlaying {
		r.resetSkipProgression()
		return
	}
	nextTurn := rules.GetNextPlayerID(r.lastSkipperID(fallbackSkipper), r.State.Players, r.State.PendingFinishID)
	logger.Info("SKIP", "Required skips complete; stack burned", "room", r.Code, "cardsBurned", len(r.stack), "nextStarter", nextTurn)
	r.broadcast(ws.StackBurnedEvent{Type: "stack_burned", Seq: r.seq, NextStarterID: nextTurn})
	r.startClearedRound(nextTurn)
}

func (r *Room) reconcileSkipProgression() {
	if r.skipRequirementsMet() {
		fallback := ""
		if r.State.CurrentTurnPlayerID != nil {
			fallback = *r.State.CurrentTurnPlayerID
		}
		r.resolveAllPass(fallback)
	}
}

func (r *Room) isActivePlayer(playerID string) bool {
	for _, player := range r.State.Players {
		if player.ID == playerID {
			return !player.IsWinner && !player.IsAbandoned
		}
	}
	return false
}

type InternalJoinEvent struct {
	ClientMsgID  string
	PlayerName   string
	UserID       string
	AvatarID     string
	RejoinToken  *string
	DeckCount    int
	WinnerCount  int
	ConnectionID string
	Outbound     chan []byte
	ReplyChan    chan string
}

type InternalLeaveEvent struct {
	ConnectionID string
}

type TurnGraceExpiredEvent struct {
	PlayerID         string
	Generation       uint64
	DeadlineUnixNano int64
}

type AbandonEvent struct {
	PlayerID         string
	DeadlineUnixNano int64
}

func randomToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (r *Room) attachConn(playerID, connID string, out chan []byte) {
	if old, ok := r.controllerConn[playerID]; ok && old != connID {
		r.sendToConn(old, ws.DeviceSupersededEvent{
			Type:   "device_superseded",
			Seq:    r.seq,
			Reason: "Another device is now controlling this account",
		})
	}
	r.connections[connID] = connectionState{ConnID: connID, PlayerID: playerID, Outbound: out}
	r.controllerConn[playerID] = connID
}

func (r *Room) handleInternalJoin(ev InternalJoinEvent) {
	userID := ev.UserID
	if userID == "" {
		r.sendToOutbound(ev.Outbound, ws.ErrorEvent{Type: "error", Code: "UNAUTHORIZED", Message: "Missing user identity"})
		select {
		case ev.ReplyChan <- "":
		default:
		}
		return
	}

	// Reconnect if this account is already seated
	for i := range r.State.Players {
		if r.State.Players[i].ID == userID {
			playerID := userID
			r.markReconnected(playerID)
			r.attachConn(playerID, ev.ConnectionID, ev.Outbound)
			r.seq++
			token := r.rejoinTokens[playerID]
			if token == "" {
				token = randomToken()
				r.rejoinTokens[playerID] = token
			}
			logger.Info("RECONNECT", "Player restored", "room", r.Code, "player", playerID, "conn", ev.ConnectionID)
			r.sendToOutbound(ev.Outbound, ws.AckEvent{
				Type: "ack", ClientMsgID: ev.ClientMsgID, AppliedSeq: r.seq,
				PlayerID: &playerID, RoomCode: &r.Code, RejoinToken: &token,
			})
			r.broadcast(ws.PlayerReconnectedEvent{Type: "player_reconnected", Seq: r.seq, PlayerID: playerID})
			// A reconnect needs a private snapshot, not a full-state broadcast to
			// every player in the room. Other clients update presence from the
			// reconnect event above.
			r.sendSnapshotToPlayer(playerID)
			r.persist()
			select {
			case ev.ReplyChan <- playerID:
			default:
			}
			return
		}
	}

	if r.State.Phase != ws.PhaseLobby {
		r.sendToOutbound(ev.Outbound, ws.ErrorEvent{Type: "error", Code: "GAME_IN_PROGRESS", Message: "Game already in progress"})
		select {
		case ev.ReplyChan <- "":
		default:
		}
		return
	}

	playerID := userID
	r.attachConn(playerID, ev.ConnectionID, ev.Outbound)
	uid := userID
	if len(r.State.Players) == 0 {
		r.State.HostID = playerID
		if ev.DeckCount != 0 || ev.WinnerCount != 0 {
			d, w := rules.ClampLobbyConfig(ev.DeckCount, ev.WinnerCount, 2)
			r.State.DeckCount = d
			r.State.WinnerCount = w
		}
	}
	name := ev.PlayerName
	if name == "" {
		name = "PLAYER"
	}
	r.State.Players = append(r.State.Players, ws.Player{
		ID: playerID, Name: name, UserID: &uid, AvatarID: ev.AvatarID, Role: ws.RoleActive,
	})
	r.seq++
	token := randomToken()
	r.rejoinTokens[playerID] = token
	logger.Info("JOIN", "Player joined room", "room", r.Code, "player", playerID, "name", name, "totalPlayers", len(r.State.Players))
	r.sendToOutbound(ev.Outbound, ws.AckEvent{
		Type: "ack", ClientMsgID: ev.ClientMsgID, AppliedSeq: r.seq,
		PlayerID: &playerID, RoomCode: &r.Code, RejoinToken: &token,
	})
	r.broadcastRoomState()
	r.persist()
	select {
	case ev.ReplyChan <- playerID:
	default:
	}
}

func removePlayerID(ids []string, playerID string) []string {
	filtered := ids[:0]
	for _, id := range ids {
		if id != playerID {
			filtered = append(filtered, id)
		}
	}
	return filtered
}

// retirePlayer removes a player from this match's active state while keeping
// their seat for an abandonment spectator. Explicit leave removes the seat
// immediately after this bookkeeping has selected a safe successor.
func (r *Room) retirePlayer(playerID string) {
	index := r.playerIndex(playerID)
	if index == -1 {
		return
	}
	r.stopAbandonTimer(playerID)
	delete(r.disconnects, playerID)
	if r.turnGrace != nil && r.turnGrace.PlayerID == playerID {
		r.stopTurnGrace()
	}
	r.playerHands[playerID] = nil
	r.State.Players[index].HandCount = 0
	r.State.Players[index].IsAbandoned = true
	r.State.Players[index].Role = ws.RoleAbandoned
	r.consecutiveSkipPlayerIDs = removePlayerID(r.consecutiveSkipPlayerIDs, playerID)
	if r.State.PendingFinishID != nil && *r.State.PendingFinishID == playerID {
		r.clearPendingFinish()
	}

	if r.State.RoundOpenerID != nil && *r.State.RoundOpenerID == playerID {
		next := rules.GetNextPlayerID(playerID, r.State.Players, r.State.PendingFinishID)
		if next == playerID {
			r.State.RoundOpenerID = nil
		} else {
			r.State.RoundOpenerID = &next
		}
	}
}

func (r *Room) resolveRetirement(playerID string) {
	r.reconcileSkipProgression()
	r.maybeEndGame()
	r.persist()
	r.broadcastGameState()
}

func (r *Room) clearPlayerRuntime(playerID string) {
	r.stopAbandonTimer(playerID)
	delete(r.disconnects, playerID)
	delete(r.resultsLobby, playerID)
	if r.turnGrace != nil && r.turnGrace.PlayerID == playerID {
		r.stopTurnGrace()
	}
	delete(r.playerHands, playerID)
	delete(r.rejoinTokens, playerID)
	delete(r.voiceMembers, playerID)
	delete(r.controllerConn, playerID)
	for id, st := range r.connections {
		if st.PlayerID == playerID {
			delete(r.connections, id)
		}
	}
}

func (r *Room) handleInternalLeave(playerID string, ev InternalLeaveEvent) {
	st, ok := r.connections[ev.ConnectionID]
	if !ok || st.PlayerID != playerID {
		return
	}
	delete(r.connections, ev.ConnectionID)
	if r.controllerConn[playerID] == ev.ConnectionID {
		delete(r.controllerConn, playerID)
		// Promote any remaining connection for this user
		for cid, cs := range r.connections {
			if cs.PlayerID == playerID {
				r.controllerConn[playerID] = cid
				break
			}
		}
	}
	if r.controllerConn[playerID] != "" {
		return // still has a device
	}
	delete(r.voiceMembers, playerID)

	if r.playerIndex(playerID) == -1 {
		return
	}
	r.markDisconnected(playerID)
	if r.State.Phase == ws.PhaseLobby && r.State.HostID == playerID {
		for _, p := range r.State.Players {
			if !p.IsDisconnected {
				r.State.HostID = p.ID
				break
			}
		}
	}
	r.seq++
	r.broadcast(ws.PlayerDisconnectedEvent{Type: "player_disconnected", Seq: r.seq, PlayerID: playerID})
	if r.State.Phase == ws.PhaseLobby {
		r.broadcastRoomState()
	}
	r.persist()
}

func (r *Room) handleLeaveRoom(playerID, connID string, ev *ws.LeaveRoomEvent) {
	if !r.isController(playerID, connID) {
		r.reject(playerID, connID, "NOT_ACTIVE_CONTROLLER", "This device is not the active controller")
		return
	}
	index := r.playerIndex(playerID)
	if index == -1 {
		r.reject(playerID, connID, "UNAUTHORIZED", "Not seated in this room")
		return
	}
	if r.State.Phase == ws.PhasePlaying {
		r.retirePlayer(playerID)
		if r.State.CurrentTurnPlayerID != nil && *r.State.CurrentTurnPlayerID == playerID {
			r.applySkip(playerID)
		}
		r.resolveRetirement(playerID)
	}

	// The player is intentionally leaving, so remove their seat after any
	// game-state transition has used their position to select a successor.
	index = r.playerIndex(playerID)
	if index == -1 {
		return
	}

	r.State.Players = append(r.State.Players[:index], r.State.Players[index+1:]...)
	r.seq++
	// Deliver the acknowledgement while this controller connection is still
	// registered; it is removed immediately afterwards.
	r.sendToConn(connID, ws.RoomLeftEvent{Type: "room_left", Seq: r.seq, RoomCode: r.Code})
	r.clearPlayerRuntime(playerID)
	if r.State.HostID == playerID && len(r.State.Players) > 0 {
		// Slice order is seating order; the first remaining player is host.
		r.State.HostID = r.State.Players[0].ID
	}
	r.commitAction(playerID, connID, ev.ClientMsgID)
	if r.clearUserRoomFn != nil {
		r.clearUserRoomFn(playerID)
	}

	if len(r.State.Players) == 0 {
		if r.destroyFn != nil {
			go r.destroyFn(r.Code)
		}
		return
	}
	if r.State.Phase == ws.PhaseLobby {
		r.broadcastRoomState()
	} else {
		r.broadcastGameState()
	}
}

func (r *Room) handleDestroyRoom(playerID, connID string, ev *ws.DestroyRoomEvent) {
	if !r.requireHostController(playerID, connID) {
		return
	}
	if r.State.Phase != ws.PhaseLobby {
		r.reject(playerID, connID, "GAME_IN_PROGRESS", "A room can only be destroyed from its lobby")
		return
	}
	r.seq++
	r.broadcast(ws.RoomDestroyedEvent{Type: "room_destroyed", Seq: r.seq, RoomCode: r.Code})
	r.commitAction(playerID, connID, ev.ClientMsgID)
	if r.destroyFn != nil {
		go r.destroyFn(r.Code)
	}
}

func (r *Room) handleTurnGraceExpired(ev TurnGraceExpiredEvent) {
	if r.State.Phase != ws.PhasePlaying || r.turnGrace == nil || r.State.CurrentTurnPlayerID == nil {
		return
	}
	if r.turnGrace.PlayerID != ev.PlayerID || r.turnGrace.Generation != ev.Generation || r.turnGrace.DeadlineUnixNano != ev.DeadlineUnixNano || *r.State.CurrentTurnPlayerID != ev.PlayerID {
		return
	}
	if r.now().UnixNano() < ev.DeadlineUnixNano {
		return
	}
	index := r.playerIndex(ev.PlayerID)
	if index == -1 || !r.State.Players[index].IsDisconnected || r.State.Players[index].IsAbandoned {
		return
	}
	r.applySkip(ev.PlayerID)
	r.persist()
	r.broadcastGameState()
}

func (r *Room) handleAbandon(ev AbandonEvent) {
	if r.State.Phase != ws.PhasePlaying {
		return
	}
	lifecycle, tracked := r.disconnects[ev.PlayerID]
	if !tracked || (ev.DeadlineUnixNano != 0 && lifecycle.AbandonDeadlineUnixNano != ev.DeadlineUnixNano) || (ev.DeadlineUnixNano != 0 && r.now().UnixNano() < lifecycle.AbandonDeadlineUnixNano) {
		return
	}
	index := r.playerIndex(ev.PlayerID)
	if index == -1 || !r.State.Players[index].IsDisconnected || r.State.Players[index].IsAbandoned {
		return
	}
	r.retirePlayer(ev.PlayerID)
	r.seq++
	logger.Info("ABANDON", "Player abandoned", "room", r.Code, "player", ev.PlayerID)
	r.broadcast(ws.PlayerAbandonedEvent{Type: "player_abandoned", Seq: r.seq, PlayerID: ev.PlayerID})
	if r.State.CurrentTurnPlayerID != nil && *r.State.CurrentTurnPlayerID == ev.PlayerID {
		r.applySkip(ev.PlayerID)
	}
	r.resolveRetirement(ev.PlayerID)
}

func (r *Room) handleSetConfig(playerID, connID string, ev *ws.SetConfigEvent) {
	if !r.requireHostController(playerID, connID) {
		return
	}
	if r.State.Phase != ws.PhaseLobby {
		r.reject(playerID, connID, "ALREADY_STARTED", "Config locked after start")
		return
	}
	d, w := rules.ClampLobbyConfig(ev.DeckCount, ev.WinnerCount, len(r.State.Players))
	if r.State.WinnerCountLocked && ev.WinnerCount != r.State.WinnerCount {
		r.reject(playerID, connID, "WINNER_COUNT_LOCKED", "Winner target is locked for this room")
		return
	}
	r.State.DeckCount = d
	if !r.State.WinnerCountLocked {
		r.State.WinnerCount = w
	}
	r.seq++
	r.commitAction(playerID, connID, ev.ClientMsgID)
	r.broadcastRoomState()
}

func (r *Room) handleResetToLobby(playerID, connID string, ev *ws.ResetToLobbyEvent) {
	if !r.requireHostController(playerID, connID) {
		return
	}
	if r.State.Phase == ws.PhaseFinished {
		r.reject(playerID, connID, "MATCH_RESULTS_ACTIVE", "Players return to the lobby individually after a completed match")
		return
	}
	r.resetForLobby()

	r.seq++
	r.commitAction(playerID, connID, ev.ClientMsgID)
	r.broadcastRoomState()
}

func (r *Room) handleReturnToLobby(playerID, connID string, ev *ws.ReturnToLobbyEvent) {
	if !r.canReturnToLobby(playerID, connID) {
		return
	}
	if r.resultsLobby[playerID] {
		r.commitAction(playerID, connID, ev.ClientMsgID)
		return
	}
	r.resultsLobby[playerID] = true
	r.seq++
	r.commitAction(playerID, connID, ev.ClientMsgID)
	r.broadcastGameState()
}

func (r *Room) resetForLobby() {
	r.stopLifecycleTimers()
	r.disconnects = make(map[string]disconnectLifecycle)
	r.resultsLobby = make(map[string]bool)
	r.setCurrentTurn("")
	r.State.Phase = ws.PhaseLobby
	r.State.RoundOpenerID = nil
	r.State.ClaimedRank = nil
	r.State.LastAction = nil
	r.State.TopPlay = nil
	r.State.StackCount = 0
	r.stack = []ws.Card{}
	r.State.Winners = []string{}
	r.State.LastMatch = nil
	r.clearPendingFinish()
	r.resetSkipProgression()
	r.State.WinnerCountLocked = false
	r.playerHands = make(map[string][]ws.Card)
	r.matchID = ""
	r.startedAt = nil

	for i := range r.State.Players {
		r.State.Players[i].HandCount = 0
		r.State.Players[i].IsWinner = false
		r.State.Players[i].IsAbandoned = false
		r.State.Players[i].Role = ws.RoleActive
	}
}

func (r *Room) handleStartGame(playerID, connID string, ev *ws.StartGameEvent) {
	if !r.requireHostController(playerID, connID) {
		return
	}
	if len(r.State.Players) < 2 {
		r.reject(playerID, connID, "NOT_ENOUGH_PLAYERS", "Need at least 2 players")
		return
	}
	if r.State.Phase == ws.PhaseFinished {
		if !r.resultsLobbyReady() {
			r.reject(playerID, connID, "WAITING_FOR_PLAYERS", "Wait for connected players to return to the lobby")
			return
		}
	} else if r.State.Phase != ws.PhaseLobby {
		r.reject(playerID, connID, "ALREADY_STARTED", "Game already started")
		return
	}
	if len(r.State.Players) > r.State.DeckCount*52 {
		r.reject(playerID, connID, "NOT_ENOUGH_CARDS", "Choose more decks or remove players so everyone can receive a card")
		return
	}

	d, w := rules.ClampLobbyConfig(r.State.DeckCount, r.State.WinnerCount, len(r.State.Players))
	if r.State.WinnerCountLocked {
		if r.State.WinnerCount < 1 || r.State.WinnerCount > len(r.State.Players)-1 {
			r.reject(playerID, connID, "LOCKED_TARGET_INVALID", "Not enough seated players for the locked winner target")
			return
		}
		r.State.DeckCount = d
	} else {
		r.State.DeckCount = d
		r.State.WinnerCount = w
		r.State.WinnerCountLocked = true
	}
	r.seq++
	r.State.Phase = ws.PhasePlaying
	r.stopLifecycleTimers()
	r.disconnects = make(map[string]disconnectLifecycle)
	r.resultsLobby = make(map[string]bool)
	now := r.now()
	r.startedAt = &now
	r.matchID = uuid.NewString()
	r.State.Winners = []string{}
	r.State.LastMatch = nil
	r.clearPendingFinish()
	r.resetSkipProgression()

	ids := make([]string, len(r.State.Players))
	for i := range r.State.Players {
		ids[i] = r.State.Players[i].ID
		r.State.Players[i].HandCount = 0
		r.State.Players[i].IsWinner = false
		r.State.Players[i].IsAbandoned = false
		r.State.Players[i].Role = ws.RoleActive
		if r.State.Players[i].IsDisconnected {
			now := r.now()
			lifecycle := disconnectLifecycle{DisconnectedAtUnixNano: now.UnixNano(), AbandonDeadlineUnixNano: now.Add(DisconnectAbandonAfter).UnixNano()}
			r.disconnects[ids[i]] = lifecycle
			r.startAbandonTimer(ids[i], lifecycle.AbandonDeadlineUnixNano)
		}
	}
	hands, _, opener := rules.Deal(rules.Shuffle(rules.GenerateDecks(r.State.DeckCount)), ids)
	r.playerHands = hands
	for i := range r.State.Players {
		r.State.Players[i].HandCount = len(hands[r.State.Players[i].ID])
	}
	r.setCurrentTurn(opener)
	r.State.RoundOpenerID = &opener
	r.State.StackCount = 0
	r.stack = []ws.Card{}
	r.State.ClaimedRank = nil
	r.State.LastAction = nil
	r.State.TopPlay = nil
	logger.Info("GAME", "Game started", "room", r.Code, "players", len(ids), "opener", opener, "decks", r.State.DeckCount, "winnerCount", r.State.WinnerCount)
	r.commitAction(playerID, connID, ev.ClientMsgID)
	r.broadcastGameState()
}

func (r *Room) handlePlayCards(playerID, connID string, ev *ws.PlayCardsEvent) {
	if r.State.Phase != ws.PhasePlaying || !r.canAct(playerID, connID) {
		return
	}
	if r.State.CurrentTurnPlayerID == nil || *r.State.CurrentTurnPlayerID != playerID {
		r.reject(playerID, connID, "NOT_YOUR_TURN", "Not your turn")
		return
	}
	if ev.ExpectedSeq != r.seq {
		r.reject(playerID, connID, "STALE_ACTION", "State has changed")
		return
	}
	if len(ev.CardIDs) < 1 {
		r.reject(playerID, connID, "INVALID_CARDS", "Play at least one card")
		return
	}

	seen := make(map[string]bool)
	for _, cid := range ev.CardIDs {
		if seen[cid] {
			r.reject(playerID, connID, "INVALID_CARDS", "Duplicate cards provided")
			return
		}
		seen[cid] = true
	}

	hand := r.playerHands[playerID]
	var playedCards []ws.Card
	for _, cid := range ev.CardIDs {
		found := false
		for _, c := range hand {
			if c.ID == cid {
				playedCards = append(playedCards, c)
				found = true
				break
			}
		}
		if !found {
			r.reject(playerID, connID, "INVALID_CARDS", "You do not hold these cards")
			return
		}
	}

	opening := r.State.StackCount == 0
	claimed := r.State.ClaimedRank
	claims := append([]ws.ClaimGroup(nil), ev.Claims...)
	if opening {
		if len(claims) == 0 && ev.ClaimedRank != nil {
			claims = []ws.ClaimGroup{{Rank: *ev.ClaimedRank, Count: len(playedCards)}}
		}
		if !rules.ValidOpeningClaims(claims, len(playedCards)) {
			r.reject(playerID, connID, "INVALID_CLAIM", "Opening groups must be four cards each, followed by one group of one to four cards")
			return
		}
		activeRank := claims[len(claims)-1].Rank
		claimed = &activeRank
		r.State.RoundOpenerID = &playerID
	} else if len(claims) != 0 {
		r.reject(playerID, connID, "INVALID_CLAIM", "Only an opening play can use multiple claimed ranks")
		return
	} else if claimed == nil {
		r.reject(playerID, connID, "MISSING_RANK", "Round has no active rank")
		return
	} else {
		claims = []ws.ClaimGroup{{Rank: *claimed, Count: len(playedCards)}}
	}

	var newHand []ws.Card
	for _, c := range hand {
		if !seen[c.ID] {
			newHand = append(newHand, c)
		}
	}
	coveredFinisher := r.pendingFinishIsTopPlay()
	r.playerHands[playerID] = newHand
	r.stack = append(r.stack, playedCards...)

	for i := range r.State.Players {
		if r.State.Players[i].ID == playerID {
			r.State.Players[i].HandCount = len(newHand)
			break
		}
	}

	r.State.ClaimedRank = claimed
	r.State.StackCount += len(playedCards)
	r.State.TopPlay = &ws.TopPlay{PlayerID: playerID, CardCount: len(playedCards), Claims: claims}
	r.State.LastAction = &ws.LastAction{
		PlayerID: playerID,
		Type:     ws.ActionAdd,
		Details:  map[string]any{"count": len(playedCards), "claims": claims},
	}
	r.resetSkipProgression()

	r.seq++
	if coveredFinisher {
		r.confirmPendingFinish()
	}
	if r.State.Phase == ws.PhasePlaying && len(newHand) == 0 {
		r.setPendingFinish(playerID)
	}
	if r.State.Phase == ws.PhasePlaying {
		nextTurn := rules.GetNextPlayerID(playerID, r.State.Players, r.State.PendingFinishID)
		r.setCurrentTurn(nextTurn)
	}
	logger.Info("PLAY", "Cards played", "room", r.Code, "player", playerID, "count", len(playedCards), "remainingHand", len(newHand), "stackTotal", r.State.StackCount)
	r.commitAction(playerID, connID, ev.ClientMsgID)
	r.broadcastGameState()
}

func (r *Room) handleChallenge(playerID, connID string, ev *ws.ChallengeEvent) {
	if r.State.Phase != ws.PhasePlaying || !r.canAct(playerID, connID) {
		return
	}
	if r.State.CurrentTurnPlayerID == nil || *r.State.CurrentTurnPlayerID != playerID {
		r.reject(playerID, connID, "NOT_YOUR_TURN", "Not your turn")
		return
	}
	if ev.ExpectedSeq != r.seq {
		r.reject(playerID, connID, "STALE_ACTION", "State has changed")
		return
	}
	if r.State.StackCount == 0 || r.State.TopPlay == nil {
		r.reject(playerID, connID, "INVALID_CHALLENGE", "Nothing to challenge")
		return
	}
	if !r.isActivePlayer(r.State.TopPlay.PlayerID) {
		r.reject(playerID, connID, "PLAYED_BY_RETIRED_PLAYER", "That play is no longer challengeable")
		return
	}
	if r.State.TopPlay.CardCount <= 0 || len(r.stack) < r.State.TopPlay.CardCount {
		r.reject(playerID, connID, "INVALID_CHALLENGE", "Nothing to challenge")
		return
	}

	challengedPlayerID := r.State.TopPlay.PlayerID
	topCards := r.stack[len(r.stack)-r.State.TopPlay.CardCount:]
	wasBluff := rules.IsClaimBluff(topCards, r.State.TopPlay.Claims)

	loserID := playerID
	nextStarterID := challengedPlayerID
	if wasBluff {
		loserID = challengedPlayerID
		nextStarterID = playerID
	}

	r.playerHands[loserID] = append(r.playerHands[loserID], r.stack...)
	for i := range r.State.Players {
		if r.State.Players[i].ID == loserID {
			r.State.Players[i].HandCount = len(r.playerHands[loserID])
		}
		if r.State.Players[i].ID == playerID {
			r.State.Players[i].ChallengesMade++
			if wasBluff {
				r.State.Players[i].ChallengesCorrect++
			}
		}
		if r.State.Players[i].ID == challengedPlayerID && wasBluff {
			r.State.Players[i].BluffsCaught++
		}
	}

	pendingMaker := r.State.PendingFinishID != nil && *r.State.PendingFinishID == challengedPlayerID
	if wasBluff && pendingMaker {
		r.clearPendingFinish()
	}

	r.seq++
	r.clearRound()
	r.State.LastAction = &ws.LastAction{PlayerID: playerID, Type: ws.ActionChallenge}
	if !wasBluff && pendingMaker {
		r.confirmPendingFinish()
	}
	if r.State.Phase == ws.PhasePlaying {
		if wasBluff {
			nextStarterID = playerID
		} else if !r.isActivePlayer(challengedPlayerID) {
			nextStarterID = rules.GetNextPlayerID(challengedPlayerID, r.State.Players, r.State.PendingFinishID)
		}
		r.setCurrentTurn(nextStarterID)
		r.State.RoundOpenerID = &nextStarterID
	}
	r.broadcast(ws.ChallengeResultEvent{
		Type: "challenge_result", Seq: r.seq,
		ChallengerID: playerID, PlayedByID: challengedPlayerID,
		WasBluff: wasBluff, RevealedCards: topCards,
		PickedUpBy: loserID, NextStarterID: nextStarterID,
	})
	r.maybeEndGame()
	r.commitAction(playerID, connID, ev.ClientMsgID)
	r.broadcastGameState()
}

func (r *Room) handleSkip(playerID, connID string, ev *ws.SkipEvent) {
	if r.State.Phase != ws.PhasePlaying {
		return
	}
	if connID != "" && !r.canAct(playerID, connID) {
		return
	}
	if r.State.CurrentTurnPlayerID == nil || *r.State.CurrentTurnPlayerID != playerID {
		return
	}
	if ev.ExpectedSeq != 0 && ev.ExpectedSeq != r.seq {
		r.reject(playerID, connID, "STALE_ACTION", "State has changed")
		return
	}
	r.applySkip(playerID)
	if ev.ClientMsgID != "" {
		r.commitAction(playerID, connID, ev.ClientMsgID)
	} else {
		r.persist()
	}
	r.broadcastGameState()
}

// applySkip is shared by an explicit Skip and a disconnected-turn timeout.
// Callers perform transport/controller validation; this function owns the
// actual game transition.
func (r *Room) applySkip(playerID string) {
	r.State.LastAction = &ws.LastAction{PlayerID: playerID, Type: ws.ActionSkip}
	r.seq++
	if r.State.TopPlay == nil || r.State.StackCount == 0 {
		r.resetSkipProgression()
		nextTurn := rules.GetNextPlayerID(playerID, r.State.Players, r.State.PendingFinishID)
		r.setCurrentTurn(nextTurn)
		r.State.RoundOpenerID = &nextTurn
		r.maybeEndGame()
		return
	}
	if index := r.playerIndex(playerID); index != -1 && rules.IsInRotation(r.State.Players[index], r.State.PendingFinishID) {
		r.recordSkip(playerID)
	}
	if r.skipRequirementsMet() {
		r.resolveAllPass(playerID)
		r.maybeEndGame()
		return
	}
	nextTurn := rules.GetNextPlayerID(playerID, r.State.Players, r.State.PendingFinishID)
	r.setCurrentTurn(nextTurn)
	r.maybeEndGame()
}

func (r *Room) confirmPendingFinish() {
	if r.State.PendingFinishID == nil {
		return
	}
	pid := *r.State.PendingFinishID
	for i := range r.State.Players {
		if r.State.Players[i].ID != pid {
			continue
		}
		if r.State.Players[i].HandCount != 0 || r.State.Players[i].IsWinner {
			r.clearPendingFinish()
			return
		}
		r.State.Players[i].IsWinner = true
		r.State.Players[i].Role = ws.RoleWinnerSpectator
		r.State.Winners = append(r.State.Winners, pid)
		r.clearPendingFinish()
		over := rules.ShouldEndGame(r.State.WinnerCount, r.State.Winners, r.State.Players)
		if over {
			r.State.Phase = ws.PhaseFinished
			r.setCurrentTurn("")
			r.stopLifecycleTimers()
			r.recordCompletedMatch()
		}
		logger.Info("VICTORY", "Player finished", "room", r.Code, "winner", pid, "place", len(r.State.Winners), "gameOver", over)
		r.broadcast(ws.PlayerWonEvent{
			Type: "player_won", Seq: r.seq, PlayerID: pid, Winners: r.State.Winners, GameOver: over,
		})
		return
	}
	r.clearPendingFinish()
}

func (r *Room) maybeEndGame() {
	if r.State.Phase != ws.PhasePlaying {
		return
	}
	if rules.ShouldEndGame(r.State.WinnerCount, r.State.Winners, r.State.Players) {
		r.State.Phase = ws.PhaseFinished
		r.setCurrentTurn("")
		r.stopLifecycleTimers()
		r.recordCompletedMatch()
		logger.Info("GAME", "Game finished", "room", r.Code, "winners", len(r.State.Winners))
	}
}

func (r *Room) recordCompletedMatch() {
	if r.recordMatchFn == nil || r.matchID == "" || r.State.Phase != ws.PhaseFinished {
		return
	}
	participants := make([]store.MatchParticipant, 0, len(r.State.Players))
	for _, player := range r.State.Players {
		userID := player.ID
		if player.UserID != nil && *player.UserID != "" {
			userID = *player.UserID
		}
		participants = append(participants, store.MatchParticipant{UserID: userID, DisplayName: player.Name, IsWinner: player.IsWinner})
	}
	if err := r.recordMatchFn(r.matchID, r.Code, participants); err != nil {
		logger.Error("STATS", "Failed to record completed match", "room", r.Code, "match", r.matchID, "error", err)
	}
}

func (r *Room) handleVoice(fromID, connID string, ev *ws.VoiceSignalEvent) {
	if !r.canAct(fromID, connID) {
		return
	}
	if ev.Kind == "leave" {
		delete(r.voiceMembers, fromID)
	} else {
		if len(r.State.Players) > MaxVoiceParticipants {
			r.reject(fromID, connID, "VOICE_PLAYER_LIMIT", "Voice chat is disabled when a room has more than eight players")
			return
		}
		if ev.Kind == "join" {
			if !r.voiceMembers[fromID] && len(r.voiceMembers) >= MaxVoiceParticipants {
				r.reject(fromID, connID, "VOICE_ROOM_LIMIT", "Voice is available for up to eight players per room")
				return
			}
			r.voiceMembers[fromID] = true
		}
	}
	msg := ws.VoiceSignalBroadcast{
		Type: "voice_signal", FromUserID: fromID,
		TargetUserID: ev.TargetUserID, Kind: ev.Kind, Payload: ev.Payload,
	}
	if ev.TargetUserID != "" {
		r.sendToPlayer(ev.TargetUserID, msg)
		return
	}
	for _, st := range r.connections {
		if st.PlayerID != fromID {
			r.sendToConn(st.ConnID, msg)
		}
	}
}

var allowedReactions = map[string]struct{}{
	"🔥": {}, "😂": {}, "😮": {}, "👏": {},
	"🃏": {}, "👀": {}, "😈": {}, "💀": {},
}

func (r *Room) handleReaction(playerID, connID string, ev *ws.ReactionEvent) {
	if !r.canAct(playerID, connID) {
		return
	}
	if _, allowed := allowedReactions[ev.Emoji]; !allowed {
		r.reject(playerID, connID, "INVALID_REACTION", "That reaction is not available")
		return
	}
	now := time.Now()
	if previous := r.lastReactionAt[playerID]; !previous.IsZero() && now.Sub(previous) < 700*time.Millisecond {
		r.reject(playerID, connID, "REACTION_RATE_LIMITED", "Wait a moment before sending another reaction")
		return
	}
	r.lastReactionAt[playerID] = now
	playerName := "PLAYER"
	for _, player := range r.State.Players {
		if player.ID == playerID {
			playerName = player.Name
			break
		}
	}
	r.broadcast(ws.ReactionBroadcast{
		Type: "reaction", ClientMsgID: ev.ClientMsgID, PlayerID: playerID, PlayerName: playerName, Emoji: ev.Emoji,
	})
}
