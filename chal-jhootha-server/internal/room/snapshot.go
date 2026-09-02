package room

import (
	"context"
	"encoding/json"
	"time"

	"chal-jhootha-server/internal/rules"
	"chal-jhootha-server/internal/ws"
)

type Snapshot struct {
	Code                     string               `json:"code"`
	Seq                      int                  `json:"seq"`
	State                    ws.GameState         `json:"state"`
	Hands                    map[string][]ws.Card `json:"hands"`
	Stack                    []ws.Card            `json:"stack"`
	MatchID                  string               `json:"matchId,omitempty"`
	ConsecutiveSkipPlayerIDs []string             `json:"consecutiveSkipPlayerIDs"`
	TurnGeneration           uint64               `json:"turnGeneration,omitempty"`
	TurnDeadlineUnixNano     int64                `json:"turnDeadlineUnixNano,omitempty"`
	CushionApplied           bool                 `json:"cushionApplied,omitempty"`
	ResultsLobby             map[string]bool      `json:"resultsLobby,omitempty"`
	StartedAtUnix            *int64               `json:"startedAtUnix,omitempty"`
	LastActivityUnix         int64                `json:"lastActivityUnix"`
}

func (r *Room) MarshalSnapshot() ([]byte, error) {
	return r.Snapshot(context.Background())
}

// marshalSnapshot is actor-only. Persistence calls it synchronously from the
// serialized room mutation that produced the state being saved.
func (r *Room) marshalSnapshot() ([]byte, error) {
	var started *int64
	if r.startedAt != nil {
		u := r.startedAt.Unix()
		started = &u
	}
	skips := r.consecutiveSkipPlayerIDs
	if skips == nil {
		skips = []string{}
	}
	var turnDeadline int64
	if !r.turnDeadline.IsZero() {
		turnDeadline = r.turnDeadline.UnixNano()
	}
	s := Snapshot{
		Code:                     r.Code,
		Seq:                      r.seq,
		State:                    r.State,
		Hands:                    r.playerHands,
		Stack:                    r.stack,
		MatchID:                  r.matchID,
		ConsecutiveSkipPlayerIDs: skips,
		TurnGeneration:           r.turnGeneration,
		TurnDeadlineUnixNano:     turnDeadline,
		CushionApplied:           r.cushionApplied,
		ResultsLobby:             r.resultsLobby,
		StartedAtUnix:            started,
		LastActivityUnix:         r.lastActivity.Unix(),
	}
	return json.Marshal(s)
}

func RestoreRoom(raw []byte, persistFn func(*Room)) (*Room, error) {
	return restoreRoom(raw, persistFn, true)
}

func restoreRoom(raw []byte, persistFn func(*Room), start bool) (*Room, error) {
	var s Snapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	r := newRoom(s.Code, persistFn, false)
	r.seq = s.Seq
	r.State = s.State
	if s.Hands != nil {
		r.playerHands = s.Hands
	}
	if s.Stack != nil {
		r.stack = s.Stack
	}
	r.matchID = s.MatchID
	changed := false
	if s.ConsecutiveSkipPlayerIDs != nil {
		r.consecutiveSkipPlayerIDs = s.ConsecutiveSkipPlayerIDs
	} else {
		r.consecutiveSkipPlayerIDs = deriveConsecutiveSkips(r.State)
		changed = true
	}
	if r.State.PendingFinishID != nil && r.State.TopPlay != nil && *r.State.PendingFinishID != r.State.TopPlay.PlayerID {
		r.confirmPendingFinish()
		changed = true
	}
	r.turnGeneration = s.TurnGeneration
	r.cushionApplied = s.CushionApplied
	if s.TurnDeadlineUnixNano > 0 {
		r.turnDeadline = time.Unix(0, s.TurnDeadlineUnixNano)
	}
	if s.ResultsLobby != nil {
		r.resultsLobby = s.ResultsLobby
	}
	if s.StartedAtUnix != nil {
		t := time.Unix(*s.StartedAtUnix, 0)
		r.startedAt = &t
	}
	if s.LastActivityUnix > 0 {
		r.lastActivity = time.Unix(s.LastActivityUnix, 0)
	}
	// Connections never restore.
	r.connections = make(map[string]connectionState)
	r.controllerConn = make(map[string]string)
	now := r.now()
	for i := range r.State.Players {
		player := &r.State.Players[i]
		if !player.IsDisconnected {
			player.IsDisconnected = true
			changed = true
		}
	}
	if r.State.Phase == ws.PhasePlaying && r.State.CurrentTurnPlayerID != nil {
		currentID := *r.State.CurrentTurnPlayerID
		gen := r.turnGeneration
		if !r.turnDeadline.IsZero() {
			delay := r.turnDeadline.Sub(now)
			if delay <= 0 {
				r.Inbox <- RoomMessage{
					PlayerID: currentID,
					Event:    TurnTimerExpiredEvent{PlayerID: currentID, Generation: gen},
				}
			} else {
				r.turnTimer = time.AfterFunc(delay, func() {
					select {
					case r.Inbox <- RoomMessage{
						PlayerID: currentID,
						Event:    TurnTimerExpiredEvent{PlayerID: currentID, Generation: gen},
					}:
					case <-r.ctx.Done():
					}
				})
			}
		} else {
			r.Inbox <- RoomMessage{
				PlayerID: currentID,
				Event:    TurnTimerExpiredEvent{PlayerID: currentID, Generation: gen},
			}
		}
	}
	if changed {
		r.persist()
	}
	if start {
		r.startActor()
	}
	return r, nil
}

func deriveConsecutiveSkips(state ws.GameState) []string {
	if state.TopPlay == nil || state.CurrentTurnPlayerID == nil {
		return []string{}
	}
	start := 0
	for i, player := range state.Players {
		if player.ID == state.TopPlay.PlayerID {
			start = i
			break
		}
	}
	current := *state.CurrentTurnPlayerID
	skips := []string{}
	for i := 1; i <= len(state.Players); i++ {
		player := state.Players[(start+i)%len(state.Players)]
		if player.ID == current {
			break
		}
		if rules.IsInRotation(player, state.PendingFinishID) {
			skips = append(skips, player.ID)
		}
	}
	return skips
}
