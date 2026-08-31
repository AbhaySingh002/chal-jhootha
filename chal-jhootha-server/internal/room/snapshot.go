package room

import (
	"encoding/json"
	"time"

	"chal-jhootha-server/internal/ws"
)

type Snapshot struct {
	Code             string               `json:"code"`
	Seq              int                  `json:"seq"`
	State            ws.GameState         `json:"state"`
	Hands            map[string][]ws.Card `json:"hands"`
	Stack            []ws.Card            `json:"stack"`
	MatchID          string               `json:"matchId,omitempty"`
	RejoinTokens     map[string]string    `json:"rejoinTokens"`
	PendingFinish    *pendingFinishRound  `json:"pendingFinish,omitempty"`
	StartedAtUnix    *int64               `json:"startedAtUnix,omitempty"`
	LastActivityUnix int64                `json:"lastActivityUnix"`
}

func (r *Room) MarshalSnapshot() ([]byte, error) {
	var started *int64
	if r.startedAt != nil {
		u := r.startedAt.Unix()
		started = &u
	}
	s := Snapshot{
		Code:             r.Code,
		Seq:              r.seq,
		State:            r.State,
		Hands:            r.playerHands,
		Stack:            r.stack,
		MatchID:          r.matchID,
		RejoinTokens:     r.rejoinTokens,
		PendingFinish:    r.pendingFinish,
		StartedAtUnix:    started,
		LastActivityUnix: r.lastActivity.Unix(),
	}
	return json.Marshal(s)
}

func RestoreRoom(raw []byte, persistFn func(*Room)) (*Room, error) {
	var s Snapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	r := NewRoom(s.Code, persistFn)
	r.seq = s.Seq
	r.State = s.State
	if s.Hands != nil {
		r.playerHands = s.Hands
	}
	if s.Stack != nil {
		r.stack = s.Stack
	}
	r.matchID = s.MatchID
	if s.RejoinTokens != nil {
		r.rejoinTokens = s.RejoinTokens
	}
	if s.PendingFinish != nil {
		r.pendingFinish = s.PendingFinish
	} else if r.State.PendingFinishID != nil {
		r.startPendingFinish(*r.State.PendingFinishID)
	}
	if s.StartedAtUnix != nil {
		t := time.Unix(*s.StartedAtUnix, 0)
		r.startedAt = &t
	}
	if s.LastActivityUnix > 0 {
		r.lastActivity = time.Unix(s.LastActivityUnix, 0)
	}
	// Connections never restore; players reconnect.
	r.connections = make(map[string]connectionState)
	r.controllerConn = make(map[string]string)
	for i := range r.State.Players {
		r.State.Players[i].IsDisconnected = true
	}
	return r, nil
}
