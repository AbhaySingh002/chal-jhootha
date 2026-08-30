package room

import (
	"context"
	"os"
	"sync"
	"time"

	"chal-jhootha-server/internal/live"
	"chal-jhootha-server/internal/logger"
	"chal-jhootha-server/internal/metrics"
	"chal-jhootha-server/internal/store"
	"chal-jhootha-server/internal/ws"
)

const (
	persistRetries       = 5
	persistRetryBaseWait = 100 * time.Millisecond
)

type roomSnapshotPayload struct {
	code string
	raw  string
	seq  int
}

type completedMatchPayload struct {
	matchID      string
	roomCode     string
	participants []store.MatchParticipant
}

type userRoomPayload struct {
	userID   string
	roomCode string
}

type lobbyHostQuery struct {
	playerID string
	reply    chan bool
}

// Manager owns room actors and a write-behind persistence worker. The actor
// only marshals a snapshot and replaces the pending snapshot for its room;
// Postgres work and retries never block gameplay.
type Manager struct {
	rooms   map[string]*Room
	mu      sync.RWMutex
	store   *store.Store
	live    *live.Runtime
	idleTTL time.Duration

	persistMu        sync.Mutex
	pendingSnapshots map[string]roomSnapshotPayload
	pendingMatches   map[string]completedMatchPayload
	pendingUserRooms map[string]userRoomPayload
	// deletedRooms is a short-lived tombstone for actor snapshots that were
	// already queued when a room was destroyed. Without it, a write-behind
	// snapshot can recreate the SQL row after DeleteRoom has removed it.
	deletedRooms   map[string]struct{}
	persistNotify  chan struct{}
	persistStarted sync.Once
	persistDone    chan struct{}
}

func NewManager(st *store.Store, runtimes ...*live.Runtime) *Manager {
	idleTTL := defaultRoomIdleTTL
	if raw := os.Getenv("ROOM_IDLE_TTL"); raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
			idleTTL = parsed
		}
	}
	var runtime *live.Runtime
	if len(runtimes) > 0 {
		runtime = runtimes[0]
	}
	return &Manager{
		rooms:            make(map[string]*Room),
		store:            st,
		live:             runtime,
		idleTTL:          idleTTL,
		pendingSnapshots: make(map[string]roomSnapshotPayload),
		pendingMatches:   make(map[string]completedMatchPayload),
		pendingUserRooms: make(map[string]userRoomPayload),
		deletedRooms:     make(map[string]struct{}),
		persistNotify:    make(chan struct{}, 1),
		persistDone:      make(chan struct{}),
	}
}

// TrackUserRoom schedules the advisory "active room" mapping only after the
// room snapshot has been persisted. It must not run in the WebSocket path,
// because user_rooms has a foreign key to rooms.
func (m *Manager) TrackUserRoom(userID, roomCode string) {
	if m.store == nil || userID == "" || roomCode == "" {
		return
	}
	m.persistMu.Lock()
	if _, deleted := m.deletedRooms[roomCode]; deleted {
		m.persistMu.Unlock()
		return
	}
	m.pendingUserRooms[userID] = userRoomPayload{userID: userID, roomCode: roomCode}
	m.persistMu.Unlock()
	m.notifyPersistence()
}

func (m *Manager) persistRoom(r *Room) {
	raw, err := r.MarshalSnapshot()
	if err != nil {
		logger.Error("PERSIST", "Failed to marshal room snapshot", "room", r.Code, "error", err)
		return
	}
	payload := roomSnapshotPayload{code: r.Code, raw: string(raw), seq: r.seq}

	// Serialise live writes with deletion as well as the Postgres queue. This
	// makes DeleteRoom the final writer: an old actor can never recreate a
	// deleted Redis snapshot after the manager has removed it.
	m.persistMu.Lock()
	if _, deleted := m.deletedRooms[payload.code]; deleted {
		m.persistMu.Unlock()
		return
	}
	if m.live != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := m.live.SaveSnapshot(ctx, live.Snapshot{Code: payload.code, Raw: payload.raw, Seq: payload.seq})
		cancel()
		if err != nil {
			m.persistMu.Unlock()
			logger.Error("RUNTIME", "Failed to save live room state", "room", payload.code, "seq", payload.seq, "error", err)
			return
		}
	}
	if m.store == nil {
		m.persistMu.Unlock()
		return
	}

	// Keep only the newest pending state per room. Sequence-guarded SQL makes
	// this safe even when an older retry is already in flight.
	if existing, ok := m.pendingSnapshots[payload.code]; !ok || payload.seq >= existing.seq {
		m.pendingSnapshots[payload.code] = payload
	}
	m.persistMu.Unlock()
	m.notifyPersistence()
}

func (m *Manager) recordCompletedMatch(matchID, roomCode string, participants []store.MatchParticipant) error {
	if m.store == nil || matchID == "" {
		return nil
	}
	m.persistMu.Lock()
	m.pendingMatches[matchID] = completedMatchPayload{
		matchID:      matchID,
		roomCode:     roomCode,
		participants: append([]store.MatchParticipant(nil), participants...),
	}
	m.persistMu.Unlock()
	m.notifyPersistence()
	return nil
}

func (m *Manager) notifyPersistence() {
	select {
	case m.persistNotify <- struct{}{}:
	default:
	}
}

func (m *Manager) StartPersistenceWorker(ctx context.Context) {
	m.persistStarted.Do(func() {
		go func() {
			defer close(m.persistDone)
			for {
				select {
				case <-ctx.Done():
					return
				case <-m.persistNotify:
					_ = m.drainPersistence(ctx)
				}
			}
		}()
	})
}

func (m *Manager) WaitForPersistenceWorker(ctx context.Context) error {
	select {
	case <-m.persistDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// FlushPersistence drains pending write-behind work during graceful shutdown.
// It may return with work still queued when the shutdown deadline expires.
func (m *Manager) FlushPersistence(ctx context.Context) error {
	return m.drainPersistence(ctx)
}

func (m *Manager) drainPersistence(ctx context.Context) error {
	for {
		snapshot, match, userRoom, ok := m.takePendingPersistence()
		if !ok {
			return nil
		}
		if snapshot != nil {
			if err := m.saveSnapshotWithRetry(ctx, *snapshot); err != nil {
				m.requeueSnapshot(*snapshot)
				return err
			}
			continue
		}
		if match != nil {
			if err := m.saveMatchWithRetry(ctx, *match); err != nil {
				m.requeueMatch(*match)
				return err
			}
			continue
		}
		if userRoom != nil {
			if err := m.saveUserRoomWithRetry(ctx, *userRoom); err != nil {
				m.requeueUserRoom(*userRoom)
				return err
			}
		}
	}
}

func (m *Manager) takePendingPersistence() (*roomSnapshotPayload, *completedMatchPayload, *userRoomPayload, bool) {
	m.persistMu.Lock()
	defer m.persistMu.Unlock()
	for code, payload := range m.pendingSnapshots {
		delete(m.pendingSnapshots, code)
		return &payload, nil, nil, true
	}
	for id, payload := range m.pendingMatches {
		delete(m.pendingMatches, id)
		return nil, &payload, nil, true
	}
	for id, payload := range m.pendingUserRooms {
		delete(m.pendingUserRooms, id)
		return nil, nil, &payload, true
	}
	return nil, nil, nil, false
}

func (m *Manager) requeueSnapshot(payload roomSnapshotPayload) {
	m.persistMu.Lock()
	if _, deleted := m.deletedRooms[payload.code]; deleted {
		m.persistMu.Unlock()
		return
	}
	if current, ok := m.pendingSnapshots[payload.code]; !ok || payload.seq > current.seq {
		m.pendingSnapshots[payload.code] = payload
	}
	m.persistMu.Unlock()
	m.notifyPersistence()
}

func (m *Manager) requeueMatch(payload completedMatchPayload) {
	m.persistMu.Lock()
	m.pendingMatches[payload.matchID] = payload
	m.persistMu.Unlock()
	m.notifyPersistence()
}

func (m *Manager) requeueUserRoom(payload userRoomPayload) {
	m.persistMu.Lock()
	if _, deleted := m.deletedRooms[payload.roomCode]; deleted {
		m.persistMu.Unlock()
		return
	}
	m.pendingUserRooms[payload.userID] = payload
	m.persistMu.Unlock()
	m.notifyPersistence()
}

func (m *Manager) saveSnapshotWithRetry(ctx context.Context, payload roomSnapshotPayload) error {
	for attempt := 1; attempt <= persistRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		// Holding this lock through the write ensures either the snapshot is
		// written before DeleteRoom, which then removes it, or it is skipped
		// after DeleteRoom has recorded its tombstone.
		m.persistMu.Lock()
		_, deleted := m.deletedRooms[payload.code]
		var err error
		if !deleted {
			err = m.store.SaveRoom(payload.code, payload.raw, payload.seq)
		}
		m.persistMu.Unlock()
		if deleted {
			return nil
		}
		if err == nil {
			metrics.PersistenceSuccess()
			logger.Debug("PERSIST", "Room snapshot saved", "room", payload.code, "seq", payload.seq, "attempt", attempt)
			return nil
		}
		if attempt == persistRetries {
			metrics.PersistenceFailure()
			logger.Error("PERSIST", "Room snapshot retries exhausted", "room", payload.code, "seq", payload.seq, "error", err)
			return err
		}
		logger.Warn("PERSIST", "Room snapshot save failed; retrying", "room", payload.code, "seq", payload.seq, "attempt", attempt, "error", err)
		metrics.PersistenceRetry()
		if !waitForRetry(ctx, attempt) {
			return ctx.Err()
		}
	}
	return nil
}

func (m *Manager) saveMatchWithRetry(ctx context.Context, payload completedMatchPayload) error {
	for attempt := 1; attempt <= persistRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		_, err := m.store.RecordCompletedMatch(payload.matchID, payload.roomCode, payload.participants)
		if err == nil {
			metrics.PersistenceSuccess()
			logger.Debug("PERSIST", "Completed match saved", "room", payload.roomCode, "match", payload.matchID, "attempt", attempt)
			return nil
		}
		if attempt == persistRetries {
			metrics.PersistenceFailure()
			logger.Error("PERSIST", "Completed match retries exhausted", "room", payload.roomCode, "match", payload.matchID, "error", err)
			return err
		}
		logger.Warn("PERSIST", "Completed match save failed; retrying", "room", payload.roomCode, "match", payload.matchID, "attempt", attempt, "error", err)
		metrics.PersistenceRetry()
		if !waitForRetry(ctx, attempt) {
			return ctx.Err()
		}
	}
	return nil
}

func (m *Manager) saveUserRoomWithRetry(ctx context.Context, payload userRoomPayload) error {
	for attempt := 1; attempt <= persistRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		m.persistMu.Lock()
		_, deleted := m.deletedRooms[payload.roomCode]
		var err error
		if !deleted {
			err = m.store.SetUserRoom(payload.userID, payload.roomCode)
		}
		m.persistMu.Unlock()
		if deleted {
			return nil
		}
		if err == nil {
			metrics.PersistenceSuccess()
			return nil
		} else if attempt == persistRetries {
			metrics.PersistenceFailure()
			logger.Error("PERSIST", "Active room mapping retries exhausted", "room", payload.roomCode, "user", payload.userID, "error", err)
			return err
		}
		metrics.PersistenceRetry()
		if !waitForRetry(ctx, attempt) {
			return ctx.Err()
		}
	}
	return nil
}

func waitForRetry(ctx context.Context, attempt int) bool {
	delay := persistRetryBaseWait * time.Duration(1<<(attempt-1))
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (m *Manager) Restore() {
	if m.store == nil && m.live == nil {
		return
	}
	if m.live != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		snapshots, err := m.live.LoadSnapshots(ctx)
		cancel()
		if err == nil && len(snapshots) > 0 {
			m.restoreLiveSnapshots(snapshots)
			return
		}
		if err != nil {
			logger.Error("RUNTIME", "Failed to load live room state", "error", err)
		}
	}
	if m.store == nil {
		return
	}
	rows, err := m.store.LoadAllRooms()
	if err != nil {
		logger.Error("PERSIST", "Failed to load rooms", "error", err)
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for _, row := range rows {
		if row.UpdatedAt.Add(m.idleTTL).Before(now) {
			if err := m.store.DeleteRoom(row.Code); err != nil {
				logger.Error("PERSIST", "Failed to remove expired room", "room", row.Code, "error", err)
			}
			continue
		}
		r, err := RestoreRoom([]byte(row.Snapshot), m.persistRoom)
		if err != nil {
			logger.Error("PERSIST", "Failed to restore room", "room", row.Code, "error", err)
			continue
		}
		r.SetIdleTTL(m.idleTTL)
		r.SetMatchRecorder(m.recordCompletedMatch)
		r.SetDestroyHandler(m.DeleteRoom)
		m.configureRuntime(r)
		if r.State.Phase == ws.PhaseFinished {
			r.recordCompletedMatch()
		}
		m.rooms[r.Code] = r
		if m.live != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			_ = m.live.SaveSnapshot(ctx, live.Snapshot{Code: r.Code, Raw: row.Snapshot, Seq: row.Seq})
			cancel()
		}
		logger.IncActiveRooms()
		logger.Info("PERSIST", "Room restored", "room", r.Code, "seq", r.seq, "phase", string(r.State.Phase))
	}
	if err := m.store.PruneExpired(now, now.Add(-m.idleTTL)); err != nil {
		logger.Error("PERSIST", "Failed to prune expired records", "error", err)
	}
}

func (m *Manager) restoreLiveSnapshots(snapshots []live.Snapshot) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, snapshot := range snapshots {
		r, err := RestoreRoom([]byte(snapshot.Raw), m.persistRoom)
		if err != nil {
			logger.Error("RUNTIME", "Failed to restore live room", "room", snapshot.Code, "error", err)
			continue
		}
		r.SetIdleTTL(m.idleTTL)
		r.SetMatchRecorder(m.recordCompletedMatch)
		r.SetDestroyHandler(m.DeleteRoom)
		m.configureRuntime(r)
		m.rooms[r.Code] = r
		logger.IncActiveRooms()
		logger.Info("RUNTIME", "Live room restored", "room", r.Code, "seq", r.seq)
	}
}

func (m *Manager) StartJanitor(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Minute)
	go func() {
		for {
			select {
			case <-ctx.Done():
				ticker.Stop()
				return
			case <-ticker.C:
				m.cleanupOldRooms()
			}
		}
	}()
}

func (m *Manager) cleanupOldRooms() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for code, r := range m.rooms {
		if r.ShouldExpire(now) {
			m.markRoomDeleted(code)
			close(r.CloseReq)
			delete(m.rooms, code)
			logger.DecActiveRooms()
			if m.store != nil {
				_ = m.store.DeleteRoom(code)
			}
			if m.live != nil {
				_ = m.live.DeleteRoom(context.Background(), code)
			}
			logger.RoomDestroyed(code, "Inactivity timeout", int64(len(m.rooms)))
		}
	}
	if m.store != nil {
		if err := m.store.PruneExpired(now, now.Add(-m.idleTTL)); err != nil {
			logger.Error("PERSIST", "Failed to prune expired records", "error", err)
		}
	}
}

func (m *Manager) GetRoom(code string) (*Room, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.rooms[code]
	return r, ok
}

func (m *Manager) GetOrCreateRoom(code string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rooms[code]; ok {
		return r
	}
	m.persistMu.Lock()
	delete(m.deletedRooms, code)
	m.persistMu.Unlock()
	start := time.Now()
	r := NewRoom(code, m.persistRoom)
	r.SetIdleTTL(m.idleTTL)
	r.SetMatchRecorder(m.recordCompletedMatch)
	r.SetDestroyHandler(m.DeleteRoom)
	m.configureRuntime(r)
	m.rooms[code] = r
	active := logger.IncActiveRooms()
	logger.RoomCreated(code, "pending", active, time.Since(start))
	return r
}

func (m *Manager) configureRuntime(r *Room) {
	if m.live == nil {
		return
	}
	r.SetActionLease(func(code string, fn func() error) error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return m.live.WithRoomLease(ctx, code, fn)
	})
}

func (m *Manager) DeleteRoom(code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rooms[code]; ok {
		m.markRoomDeleted(code)
		close(r.CloseReq)
		delete(m.rooms, code)
		active := logger.DecActiveRooms()
		if m.store != nil {
			_ = m.store.DeleteRoom(code)
		}
		if m.live != nil {
			_ = m.live.DeleteRoom(context.Background(), code)
		}
		logger.RoomDestroyed(code, "Explicit delete", active)
	}
}

func (m *Manager) markRoomDeleted(code string) {
	m.persistMu.Lock()
	m.deletedRooms[code] = struct{}{}
	delete(m.pendingSnapshots, code)
	for userID, pending := range m.pendingUserRooms {
		if pending.roomCode == code {
			delete(m.pendingUserRooms, userID)
		}
	}
	m.persistMu.Unlock()
}

func (m *Manager) HasRoom(code string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	_, ok := m.rooms[code]
	return ok
}

func (m *Manager) Store() *store.Store {
	return m.store
}

// IsLobbyHost asks the room actor instead of reading mutable room state from
// an HTTP goroutine. It gates social invites to the current lobby host.
func (m *Manager) IsLobbyHost(code, playerID string) bool {
	r, ok := m.GetRoom(code)
	if !ok {
		return false
	}
	reply := make(chan bool, 1)
	select {
	case r.Inbox <- RoomMessage{Event: lobbyHostQuery{playerID: playerID, reply: reply}}:
	case <-time.After(time.Second):
		return false
	}
	select {
	case ok := <-reply:
		return ok
	case <-time.After(time.Second):
		return false
	}
}

// RuntimeHealthy lets the WebSocket path refuse mutations when Redis is down,
// instead of allowing a game action that cannot be made visible to peers.
func (m *Manager) RuntimeHealthy(ctx context.Context) bool {
	if m.live == nil {
		return true
	}
	return m.live.Ping(ctx) == nil
}
