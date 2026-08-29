package room

import (
	"context"
	"os"
	"sync"
	"time"

	"chal-jhootha-server/internal/logger"
	"chal-jhootha-server/internal/store"
	"chal-jhootha-server/internal/ws"
)

type Manager struct {
	rooms   map[string]*Room
	mu      sync.RWMutex
	store   *store.Store
	idleTTL time.Duration
}

func NewManager(st *store.Store) *Manager {
	idleTTL := defaultRoomIdleTTL
	if raw := os.Getenv("ROOM_IDLE_TTL"); raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
			idleTTL = parsed
		}
	}
	return &Manager{
		rooms:   make(map[string]*Room),
		store:   st,
		idleTTL: idleTTL,
	}
}

func (m *Manager) persistRoom(r *Room) {
	if m.store == nil {
		return
	}
	raw, err := r.MarshalSnapshot()
	if err != nil {
		logger.Error("PERSIST", "Failed to marshal room snapshot", "room", r.Code, "error", err)
		return
	}
	if err := m.store.SaveRoom(r.Code, string(raw), r.seq); err != nil {
		logger.Error("PERSIST", "Failed to save room", "room", r.Code, "error", err)
		return
	}
	logger.Debug("PERSIST", "Room snapshot saved", "room", r.Code, "seq", r.seq)
}

func (m *Manager) recordCompletedMatch(matchID, roomCode string, participants []store.MatchParticipant) error {
	if m.store == nil {
		return nil
	}
	_, err := m.store.RecordCompletedMatch(matchID, roomCode, participants)
	return err
}

func (m *Manager) Restore() {
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
		if r.State.Phase == ws.PhaseFinished {
			r.recordCompletedMatch()
		}
		m.rooms[r.Code] = r
		logger.IncActiveRooms()
		logger.Info("PERSIST", "Room restored", "room", r.Code, "seq", r.seq, "phase", string(r.State.Phase))
	}
	if err := m.store.PruneExpired(now, now.Add(-m.idleTTL)); err != nil {
		logger.Error("PERSIST", "Failed to prune expired records", "error", err)
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
			close(r.CloseReq)
			delete(m.rooms, code)
			logger.DecActiveRooms()
			if m.store != nil {
				_ = m.store.DeleteRoom(code)
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
	start := time.Now()
	r := NewRoom(code, m.persistRoom)
	r.SetIdleTTL(m.idleTTL)
	r.SetMatchRecorder(m.recordCompletedMatch)
	m.rooms[code] = r
	active := logger.IncActiveRooms()
	logger.RoomCreated(code, "pending", active, time.Since(start))
	return r
}

func (m *Manager) DeleteRoom(code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rooms[code]; ok {
		close(r.CloseReq)
		delete(m.rooms, code)
		active := logger.DecActiveRooms()
		if m.store != nil {
			_ = m.store.DeleteRoom(code)
		}
		logger.RoomDestroyed(code, "Explicit delete", active)
	}
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
