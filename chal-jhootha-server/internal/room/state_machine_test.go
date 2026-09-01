package room

import (
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"

	"chal-jhootha-server/internal/ws"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var machineMsgSeq atomic.Int64

func card(id, rank string) ws.Card {
	return ws.Card{ID: id, Rank: ws.Rank(rank), Suit: ws.Spades}
}

func machineMsgID(kind string) string {
	return fmt.Sprintf("%s-%d", kind, machineMsgSeq.Add(1))
}

func newMachineRoom(t *testing.T, playerCount, winnerCount int) (*Room, []lifecycleClient) {
	t.Helper()
	r := newRoom("MACHINE", nil, false)
	clients := make([]lifecycleClient, 0, playerCount)
	for i := 0; i < playerCount; i++ {
		client := lifecycleClient{id: string(rune('a' + i)), conn: string(rune('a'+i)) + "-conn", out: make(chan []byte, 64)}
		reply := make(chan string, 1)
		r.processMessage(RoomMessage{ConnectionID: client.conn, Event: InternalJoinEvent{
			ClientMsgID: "join-" + client.id, PlayerName: client.id, UserID: client.id, ConnectionID: client.conn, Outbound: client.out, ReplyChan: reply,
		}})
		require.Equal(t, client.id, <-reply)
		clients = append(clients, client)
	}
	r.processMessage(RoomMessage{ConnectionID: clients[0].conn, PlayerID: clients[0].id, Event: &ws.SetConfigEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "set_config", ClientMsgID: "cfg"}, DeckCount: 1, WinnerCount: winnerCount,
	}})
	r.processMessage(RoomMessage{ConnectionID: clients[0].conn, PlayerID: clients[0].id, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{Type: "start_game", ClientMsgID: "start"}}})
	require.Equal(t, ws.PhasePlaying, r.State.Phase)
	return r, clients
}

func setHands(r *Room, hands map[string][]ws.Card, turn string) {
	r.State.Phase = ws.PhasePlaying
	r.State.Winners = []string{}
	r.clearPendingFinish()
	r.playerHands = hands
	for i := range r.State.Players {
		r.State.Players[i].HandCount = len(hands[r.State.Players[i].ID])
		r.State.Players[i].IsWinner = false
		r.State.Players[i].IsAbandoned = false
		r.State.Players[i].Role = ws.RoleActive
	}
	r.setCurrentTurn(turn)
	r.State.RoundOpenerID = &turn
	r.clearRound()
}

func machinePlay(t *testing.T, r *Room, client lifecycleClient, cards []ws.Card, claims []ws.ClaimGroup) {
	t.Helper()
	ids := make([]string, len(cards))
	for i, c := range cards {
		ids[i] = c.ID
	}
	seq := r.seq
	r.processMessage(RoomMessage{ConnectionID: client.conn, PlayerID: client.id, Event: &ws.PlayCardsEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "play_cards", ClientMsgID: machineMsgID(client.id + "-play")},
		CardIDs:         ids,
		Claims:          claims,
		ExpectedSeq:     seq,
	}})
}

func machineSkip(t *testing.T, r *Room, client lifecycleClient) {
	t.Helper()
	seq := r.seq
	r.processMessage(RoomMessage{ConnectionID: client.conn, PlayerID: client.id, Event: &ws.SkipEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "skip", ClientMsgID: machineMsgID(client.id + "-skip")}, ExpectedSeq: seq,
	}})
}

func machineChallenge(t *testing.T, r *Room, client lifecycleClient) {
	t.Helper()
	seq := r.seq
	r.processMessage(RoomMessage{ConnectionID: client.conn, PlayerID: client.id, Event: &ws.ChallengeEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "challenge", ClientMsgID: machineMsgID(client.id + "-chal")}, ExpectedSeq: seq,
	}})
}

func TestStateMachineOpeningClaims(t *testing.T) {
	r, clients := newMachineRoom(t, 2, 1)
	a, b := clients[0], clients[1]
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A"), card("a2", "2"), card("a3", "3"), card("a4", "4"), card("a5", "5")},
		"b": {card("b1", "K")},
	}, "a")

	machinePlay(t, r, a, []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "K", Count: 1}})
	require.Equal(t, 1, r.State.StackCount)
	machineChallenge(t, r, b)
	assert.Equal(t, "b", *r.State.CurrentTurnPlayerID)
	assert.Greater(t, r.State.Players[r.playerIndex("a")].HandCount, 0)

	setHands(r, map[string][]ws.Card{"a": {card("a1", "A"), card("a2", "2")}, "b": {card("b1", "K")}}, "a")
	machinePlay(t, r, a, []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	machineChallenge(t, r, b)
	assert.Greater(t, r.State.Players[r.playerIndex("b")].HandCount, 0)

	setHands(r, map[string][]ws.Card{
		"a": {card("k1", "K"), card("k2", "K"), card("k3", "K"), card("k4", "K"), card("q1", "Q"), card("a1", "A")},
		"b": {card("b1", "2")},
	}, "a")
	machinePlay(t, r, a, []ws.Card{card("k1", "K"), card("k2", "K"), card("k3", "K"), card("k4", "K"), card("q1", "Q")}, []ws.ClaimGroup{{Rank: "K", Count: 4}, {Rank: "Q", Count: 1}})
	require.Equal(t, 5, r.State.StackCount)
	assert.Equal(t, ws.Rank("Q"), *r.State.ClaimedRank)

	setHands(r, map[string][]ws.Card{
		"a": {card("x1", "A"), card("x2", "2"), card("x3", "3"), card("x4", "4"), card("x5", "5")},
		"b": {card("b1", "K")},
	}, "a")
	seq := r.seq
	machinePlay(t, r, a, []ws.Card{card("x1", "A"), card("x2", "2"), card("x3", "3"), card("x4", "4"), card("x5", "5")}, []ws.ClaimGroup{{Rank: "A", Count: 3}, {Rank: "2", Count: 2}})
	assert.Equal(t, seq, r.seq)

	seq = r.seq
	machinePlay(t, r, a, []ws.Card{card("x1", "A"), card("x2", "2"), card("x3", "3"), card("x4", "4"), card("x5", "5")}, []ws.ClaimGroup{{Rank: "2", Count: 5}})
	assert.Equal(t, seq, r.seq)
}

func TestStateMachineScrambledComboTruth(t *testing.T) {
	r, clients := newMachineRoom(t, 2, 1)
	a, b := clients[0], clients[1]
	played := []ws.Card{card("q1", "Q"), card("k1", "K"), card("k2", "K"), card("k3", "K"), card("k4", "K")}
	setHands(r, map[string][]ws.Card{"a": played, "b": {card("b1", "2")}}, "a")
	machinePlay(t, r, a, played, []ws.ClaimGroup{{Rank: "K", Count: 4}, {Rank: "Q", Count: 1}})
	machineChallenge(t, r, b)
	assert.Greater(t, r.State.Players[r.playerIndex("b")].HandCount, 0)

	setHands(r, map[string][]ws.Card{"a": played, "b": {card("b1", "2")}}, "a")
	machinePlay(t, r, a, played, []ws.ClaimGroup{{Rank: "K", Count: 4}, {Rank: "A", Count: 1}})
	machineChallenge(t, r, b)
	assert.Greater(t, r.State.Players[r.playerIndex("a")].HandCount, 0)
}

func TestStateMachineAddResetsSkipsAndRejectsCombo(t *testing.T) {
	r, clients := newMachineRoom(t, 4, 1)
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A")},
		"b": {card("b1", "A"), card("b2", "2")},
		"c": {card("c1", "3")},
		"d": {card("d1", "4")},
	}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	machineSkip(t, r, clients[1])
	machineSkip(t, r, clients[2])
	assert.Equal(t, []string{"b", "c"}, r.consecutiveSkipPlayerIDs)

	seq := r.seq
	machinePlay(t, r, clients[3], []ws.Card{card("d1", "4")}, []ws.ClaimGroup{{Rank: "4", Count: 4}, {Rank: "A", Count: 1}})
	assert.Equal(t, seq, r.seq)

	machinePlay(t, r, clients[3], []ws.Card{card("d1", "4")}, nil)
	assert.Empty(t, r.consecutiveSkipPlayerIDs)
	assert.Equal(t, "d", r.State.TopPlay.PlayerID)
	assert.Equal(t, 2, r.State.StackCount)
}

func TestStateMachineBurnAfterFullSkipCircle(t *testing.T) {
	r, clients := newMachineRoom(t, 4, 1)
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A"), card("a2", "2")},
		"b": {card("b1", "3")},
		"c": {card("c1", "4")},
		"d": {card("d1", "5")},
	}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	machineSkip(t, r, clients[1])
	machineSkip(t, r, clients[2])
	machineSkip(t, r, clients[3])
	assert.Equal(t, 1, r.State.StackCount)
	machineSkip(t, r, clients[0])
	assert.Zero(t, r.State.StackCount)
	assert.Nil(t, r.State.TopPlay)
	assert.Equal(t, "b", *r.State.CurrentTurnPlayerID)
}

func TestStateMachineAddClearsEarlierSkipsBeforeBurn(t *testing.T) {
	r, clients := newMachineRoom(t, 4, 1)
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A"), card("a2", "9")},
		"b": {card("b1", "2")},
		"c": {card("c1", "3")},
		"d": {card("d1", "A"), card("d2", "4")},
	}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	machineSkip(t, r, clients[1])
	machineSkip(t, r, clients[2])
	machinePlay(t, r, clients[3], []ws.Card{card("d1", "A")}, nil)
	assert.Empty(t, r.consecutiveSkipPlayerIDs)
	machineSkip(t, r, clients[0])
	machineSkip(t, r, clients[1])
	machineSkip(t, r, clients[2])
	assert.Equal(t, 2, r.State.StackCount)
	machineSkip(t, r, clients[3])
	assert.Zero(t, r.State.StackCount)
}

func TestStateMachineChallengeClearsBurnProgress(t *testing.T) {
	r, clients := newMachineRoom(t, 3, 1)
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A"), card("a2", "2")},
		"b": {card("b1", "3")},
		"c": {card("c1", "4")},
	}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "K", Count: 1}})
	machineSkip(t, r, clients[1])
	machineChallenge(t, r, clients[2])
	assert.Empty(t, r.consecutiveSkipPlayerIDs)
	assert.Zero(t, r.State.StackCount)
	assert.Equal(t, "c", *r.State.CurrentTurnPlayerID)
}

func TestStateMachinePendingFinishOpponentsPass(t *testing.T) {
	r, clients := newMachineRoom(t, 3, 1)
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A")},
		"b": {card("b1", "2")},
		"c": {card("c1", "3")},
	}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	require.Equal(t, "a", *r.State.PendingFinishID)
	assert.Equal(t, "b", *r.State.CurrentTurnPlayerID)
	machineSkip(t, r, clients[1])
	assert.Equal(t, ws.PhasePlaying, r.State.Phase)
	machineSkip(t, r, clients[2])
	assert.Equal(t, []string{"a"}, r.State.Winners)
	assert.Equal(t, ws.PhaseFinished, r.State.Phase)
}

func TestStateMachineCoveringAddConfirmsAndMayPendCover(t *testing.T) {
	r, clients := newMachineRoom(t, 3, 2)
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A")},
		"b": {card("b1", "A")},
		"c": {card("c1", "3"), card("c2", "4")},
	}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	machinePlay(t, r, clients[1], []ws.Card{card("b1", "A")}, nil)
	assert.Equal(t, []string{"a"}, r.State.Winners)
	require.NotNil(t, r.State.PendingFinishID)
	assert.Equal(t, "b", *r.State.PendingFinishID)
	assert.Equal(t, 2, r.State.StackCount)
	assert.Equal(t, "b", r.State.TopPlay.PlayerID)
	assert.Equal(t, ws.PhasePlaying, r.State.Phase)
}

func TestStateMachineTruthAndBluffFinalChallenge(t *testing.T) {
	r, clients := newMachineRoom(t, 2, 1)
	setHands(r, map[string][]ws.Card{"a": {card("a1", "A")}, "b": {card("b1", "2")}}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	machineChallenge(t, r, clients[1])
	assert.Equal(t, []string{"a"}, r.State.Winners)
	assert.Equal(t, ws.PhaseFinished, r.State.Phase)

	r, clients = newMachineRoom(t, 2, 1)
	setHands(r, map[string][]ws.Card{"a": {card("a1", "A")}, "b": {card("b1", "2")}}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "K", Count: 1}})
	machineChallenge(t, r, clients[1])
	assert.Nil(t, r.State.PendingFinishID)
	assert.Equal(t, ws.PhasePlaying, r.State.Phase)
	assert.Equal(t, "b", *r.State.CurrentTurnPlayerID)
	assert.Greater(t, r.State.Players[r.playerIndex("a")].HandCount, 0)
}

func TestStateMachineAbandonedPlayerExcludedFromBurn(t *testing.T) {
	r, clients := newMachineRoom(t, 3, 1)
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A"), card("a2", "2")},
		"b": {card("b1", "3")},
		"c": {card("c1", "4")},
	}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	r.retirePlayer("c")
	machineSkip(t, r, clients[1])
	machineSkip(t, r, clients[0])
	assert.Zero(t, r.State.StackCount)
}

func TestStateMachineSnapshotRestoresSkipAndCoveredFinisher(t *testing.T) {
	r, clients := newMachineRoom(t, 3, 2)
	setHands(r, map[string][]ws.Card{
		"a": {card("a1", "A")},
		"b": {card("b1", "2"), card("b2", "A")},
		"c": {card("c1", "3"), card("c2", "4")},
	}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	machineSkip(t, r, clients[1])
	raw, err := r.marshalSnapshot()
	require.NoError(t, err)
	restored, err := restoreRoom(raw, nil, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"b"}, restored.consecutiveSkipPlayerIDs)
	assert.Equal(t, "a", *restored.State.PendingFinishID)

	var snap map[string]any
	require.NoError(t, json.Unmarshal(raw, &snap))
	delete(snap, "consecutiveSkipPlayerIDs")
	legacy, err := json.Marshal(snap)
	require.NoError(t, err)
	derived, err := restoreRoom(legacy, nil, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"b"}, derived.consecutiveSkipPlayerIDs)

	machinePlay(t, r, clients[2], []ws.Card{card("c1", "3")}, nil)
	assert.Equal(t, []string{"a"}, r.State.Winners)
	assert.Nil(t, r.State.PendingFinishID)
	coveredRaw, err := r.marshalSnapshot()
	require.NoError(t, err)
	var covered map[string]any
	require.NoError(t, json.Unmarshal(coveredRaw, &covered))
	delete(covered, "consecutiveSkipPlayerIDs")
	state := covered["state"].(map[string]any)
	state["pendingFinishId"] = "a"
	legacyCovered, err := json.Marshal(covered)
	require.NoError(t, err)
	reconciled, err := restoreRoom(legacyCovered, nil, false)
	require.NoError(t, err)
	assert.Contains(t, reconciled.State.Winners, "a")
	assert.Nil(t, reconciled.State.PendingFinishID)
}

func TestStateMachineStaleAndDuplicateCannotDoublePlace(t *testing.T) {
	r, clients := newMachineRoom(t, 2, 1)
	setHands(r, map[string][]ws.Card{"a": {card("a1", "A")}, "b": {card("b1", "2")}}, "a")
	machinePlay(t, r, clients[0], []ws.Card{card("a1", "A")}, []ws.ClaimGroup{{Rank: "A", Count: 1}})
	seq := r.seq
	machineSkip(t, r, clients[1])
	assert.Equal(t, []string{"a"}, r.State.Winners)
	r.processMessage(RoomMessage{ConnectionID: clients[1].conn, PlayerID: clients[1].id, Event: &ws.SkipEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "skip", ClientMsgID: "stale"}, ExpectedSeq: seq,
	}})
	assert.Equal(t, []string{"a"}, r.State.Winners)
}
