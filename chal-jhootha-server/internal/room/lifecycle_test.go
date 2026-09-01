package room

import (
	"encoding/json"
	"testing"
	"time"

	"chal-jhootha-server/internal/ws"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func init() {
	DisconnectedTurnGrace = 10 * time.Millisecond
	DisconnectAbandonAfter = 500 * time.Millisecond
}


type lifecycleClient struct {
	id   string
	conn string
	out  chan []byte
}

func newLifecycleRoom(t *testing.T, playerCount int) (*Room, []lifecycleClient) {
	t.Helper()
	
	r := newRoom("LIFECYCLE", nil, false)
	clients := make([]lifecycleClient, 0, playerCount)
	for i := 0; i < playerCount; i++ {
		client := lifecycleClient{id: string(rune('a' + i)), conn: string(rune('a'+i)) + "-conn", out: make(chan []byte, 64)}
		reply := make(chan string, 1)
		r.processMessage(RoomMessage{ConnectionID: client.conn, Event: InternalJoinEvent{
			ClientMsgID:  "join-" + client.id,
			PlayerName:   client.id,
			UserID:       client.id,
			ConnectionID: client.conn,
			Outbound:     client.out,
			ReplyChan:    reply,
		}})
		require.Equal(t, client.id, <-reply)
		clients = append(clients, client)
	}
	r.processMessage(RoomMessage{ConnectionID: clients[0].conn, PlayerID: clients[0].id, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{Type: "start_game", ClientMsgID: "start"}}})
	require.Equal(t, ws.PhasePlaying, r.State.Phase)
	return r, clients
}

func processQueued(r *Room) {
	for {
		select {
		case message := <-r.Inbox:
			r.processMessage(message)
		default:
			return
		}
	}
}

func lifecycleClientByID(t *testing.T, clients []lifecycleClient, playerID string) lifecycleClient {
	t.Helper()
	for _, client := range clients {
		if client.id == playerID {
			return client
		}
	}
	t.Fatalf("client %q not found", playerID)
	return lifecycleClient{}
}

func otherLifecycleClient(clients []lifecycleClient, playerID string) lifecycleClient {
	for _, client := range clients {
		if client.id != playerID {
			return client
		}
	}
	return lifecycleClient{}
}

func nonHostNonCurrentClient(clients []lifecycleClient, currentID string) lifecycleClient {
	for _, client := range clients {
		if client.id != clients[0].id && client.id != currentID {
			return client
		}
	}
	return lifecycleClient{}
}

func TestDisconnectedCurrentTurnUsesGraceThenCanonicalSkip(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	current := lifecycleClientByID(t, clients, currentID)

	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: InternalLeaveEvent{ConnectionID: current.conn}})
	require.NotNil(t, r.turnGrace)
	assert.Equal(t, current.id, *r.State.CurrentTurnPlayerID)

	time.Sleep(DisconnectedTurnGrace + 10*time.Millisecond)
	processQueued(r)
	assert.NotEqual(t, current.id, *r.State.CurrentTurnPlayerID)
	assert.True(t, r.State.Players[r.playerIndex(current.id)].IsDisconnected)
}

func TestReconnectCancelsDisconnectedTurnGrace(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	current := lifecycleClientByID(t, clients, currentID)
	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: InternalLeaveEvent{ConnectionID: current.conn}})

	reply := make(chan string, 1)
	r.processMessage(RoomMessage{ConnectionID: "reconnect", Event: InternalJoinEvent{ClientMsgID: "reconnect", PlayerName: current.id, UserID: current.id, ConnectionID: "reconnect", Outbound: make(chan []byte, 16), ReplyChan: reply}})
	require.Equal(t, current.id, <-reply)
	time.Sleep(DisconnectedTurnGrace + 10*time.Millisecond)
	processQueued(r)

	assert.Equal(t, current.id, *r.State.CurrentTurnPlayerID)
	assert.Nil(t, r.turnGrace)
	assert.False(t, r.State.Players[r.playerIndex(current.id)].IsDisconnected)
}

func TestLaterDisconnectedTurnStartsGraceAndStaleGraceCannotMutate(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	next := otherLifecycleClient(clients, currentID)
	r.processMessage(RoomMessage{ConnectionID: next.conn, PlayerID: next.id, Event: InternalLeaveEvent{ConnectionID: next.conn}})
	assert.Nil(t, r.turnGrace)

	current := lifecycleClientByID(t, clients, currentID)
	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{Type: "skip", ClientMsgID: "skip"}, ExpectedSeq: r.seq}})
	require.Equal(t, next.id, *r.State.CurrentTurnPlayerID)
	require.NotNil(t, r.turnGrace)
	stale := *r.turnGrace

	r.setCurrentTurn(current.id)
	before := r.seq
	r.processMessage(RoomMessage{PlayerID: stale.PlayerID, Event: TurnGraceExpiredEvent{PlayerID: stale.PlayerID, Generation: stale.Generation, DeadlineUnixNano: stale.DeadlineUnixNano}})
	assert.Equal(t, before, r.seq)
	assert.Equal(t, current.id, *r.State.CurrentTurnPlayerID)

	time.Sleep(DisconnectedTurnGrace + 10*time.Millisecond)
	processQueued(r)
	assert.Equal(t, current.id, *r.State.CurrentTurnPlayerID)
}

func TestRepeatedDisconnectedTurnsReceiveTheirOwnGrace(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	next := otherLifecycleClient(clients, currentID)
	r.processMessage(RoomMessage{ConnectionID: next.conn, PlayerID: next.id, Event: InternalLeaveEvent{ConnectionID: next.conn}})

	current := lifecycleClientByID(t, clients, currentID)
	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{Type: "skip", ClientMsgID: "first-pass"}, ExpectedSeq: r.seq}})
	require.Equal(t, next.id, *r.State.CurrentTurnPlayerID)
	firstGrace := *r.turnGrace
	time.Sleep(DisconnectedTurnGrace + 10*time.Millisecond)
	processQueued(r)
	require.Equal(t, current.id, *r.State.CurrentTurnPlayerID)

	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{Type: "skip", ClientMsgID: "second-pass"}, ExpectedSeq: r.seq}})
	require.Equal(t, next.id, *r.State.CurrentTurnPlayerID)
	require.NotNil(t, r.turnGrace)
	assert.Greater(t, r.turnGrace.Generation, firstGrace.Generation)
	assert.Greater(t, r.turnGrace.DeadlineUnixNano, firstGrace.DeadlineUnixNano)
}

func TestDisconnectedOpenerGraceUsesNormalBurnPath(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	openerID := *r.State.RoundOpenerID
	opener := lifecycleClientByID(t, clients, openerID)
	card := r.playerHands[opener.id][0]
	r.processMessage(RoomMessage{ConnectionID: opener.conn, PlayerID: opener.id, Event: &ws.PlayCardsEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "play_cards", ClientMsgID: "open"},
		CardIDs:         []string{card.ID},
		Claims:          []ws.ClaimGroup{{Rank: card.Rank, Count: 1}},
		ExpectedSeq:     r.seq,
	}})
	require.Equal(t, 1, r.State.StackCount)

	r.processMessage(RoomMessage{ConnectionID: opener.conn, PlayerID: opener.id, Event: InternalLeaveEvent{ConnectionID: opener.conn}})
	responder := lifecycleClientByID(t, clients, *r.State.CurrentTurnPlayerID)
	r.processMessage(RoomMessage{ConnectionID: responder.conn, PlayerID: responder.id, Event: &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{Type: "skip", ClientMsgID: "pass"}, ExpectedSeq: r.seq}})
	require.Equal(t, opener.id, *r.State.CurrentTurnPlayerID)
	require.NotNil(t, r.turnGrace)

	time.Sleep(DisconnectedTurnGrace + 10*time.Millisecond)
	processQueued(r)
	assert.Zero(t, r.State.StackCount)
	assert.Nil(t, r.State.TopPlay)
	assert.Equal(t, responder.id, *r.State.CurrentTurnPlayerID)
}

func TestDisconnectedPendingFinishResponderAutoSkips(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	winnerID := *r.State.CurrentTurnPlayerID
	winner := lifecycleClientByID(t, clients, winnerID)
	lastCard := r.playerHands[winner.id][0]
	r.playerHands[winner.id] = []ws.Card{lastCard}
	r.State.Players[r.playerIndex(winner.id)].HandCount = 1
	r.processMessage(RoomMessage{ConnectionID: winner.conn, PlayerID: winner.id, Event: &ws.PlayCardsEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "play_cards", ClientMsgID: "last"},
		CardIDs:         []string{lastCard.ID},
		Claims:          []ws.ClaimGroup{{Rank: lastCard.Rank, Count: 1}},
		ExpectedSeq:     r.seq,
	}})
	require.Equal(t, winner.id, *r.State.PendingFinishID)
	responder := lifecycleClientByID(t, clients, *r.State.CurrentTurnPlayerID)
	r.processMessage(RoomMessage{ConnectionID: responder.conn, PlayerID: responder.id, Event: InternalLeaveEvent{ConnectionID: responder.conn}})
	time.Sleep(DisconnectedTurnGrace + 10*time.Millisecond)
	processQueued(r)

	assert.Equal(t, []string{winner.id}, r.State.Winners)
	assert.Equal(t, ws.PhaseFinished, r.State.Phase)
}

func TestAbandonmentBurnsHandAndReconnectsAsSpectator(t *testing.T) {
	r, clients := newLifecycleRoom(t, 3)
	currentID := *r.State.CurrentTurnPlayerID
	target := nonHostNonCurrentClient(clients, currentID)
	startingHand := len(r.playerHands[target.id])
	require.Positive(t, startingHand)

	r.processMessage(RoomMessage{ConnectionID: target.conn, PlayerID: target.id, Event: InternalLeaveEvent{ConnectionID: target.conn}})
	time.Sleep(DisconnectAbandonAfter + 10*time.Millisecond)
	processQueued(r)

	player := r.State.Players[r.playerIndex(target.id)]
	assert.True(t, player.IsAbandoned)
	assert.Equal(t, ws.RoleAbandoned, player.Role)
	assert.Equal(t, 0, player.HandCount)
	assert.Empty(t, r.playerHands[target.id])
	assert.NotContains(t, r.State.Winners, target.id)
	assert.Equal(t, ws.PhasePlaying, r.State.Phase)

	reply := make(chan string, 1)
	r.processMessage(RoomMessage{ConnectionID: "spectator", Event: InternalJoinEvent{ClientMsgID: "spectator", PlayerName: target.id, UserID: target.id, ConnectionID: "spectator", Outbound: make(chan []byte, 16), ReplyChan: reply}})
	require.Equal(t, target.id, <-reply)
	player = r.State.Players[r.playerIndex(target.id)]
	assert.True(t, player.IsAbandoned)
	assert.False(t, player.IsDisconnected)

	r.processMessage(RoomMessage{ConnectionID: clients[0].conn, PlayerID: clients[0].id, Event: &ws.ResetToLobbyEvent{BaseClientEvent: ws.BaseClientEvent{Type: "reset_to_lobby", ClientMsgID: "reset"}}})
	player = r.State.Players[r.playerIndex(target.id)]
	assert.False(t, player.IsAbandoned)
	assert.Equal(t, ws.RoleActive, player.Role)
}

func TestAbandonmentWithOneActivePlayerEndsMatchWithoutAwardingRetiree(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	target := otherLifecycleClient(clients, currentID)
	r.processMessage(RoomMessage{ConnectionID: target.conn, PlayerID: target.id, Event: InternalLeaveEvent{ConnectionID: target.conn}})

	time.Sleep(DisconnectAbandonAfter + 10*time.Millisecond)
	processQueued(r)

	require.Equal(t, ws.PhaseFinished, r.State.Phase)
	assert.NotContains(t, r.State.Winners, target.id)
}

func TestSnapshotRecoveryPreservesOriginalDeadlines(t *testing.T) {
	r, clients := newLifecycleRoom(t, 3)
	target := nonHostNonCurrentClient(clients, *r.State.CurrentTurnPlayerID)
	r.processMessage(RoomMessage{ConnectionID: target.conn, PlayerID: target.id, Event: InternalLeaveEvent{ConnectionID: target.conn}})
	original := r.disconnects[target.id]
	raw, err := r.marshalSnapshot()
	require.NoError(t, err)

	time.Sleep(300 * time.Millisecond)
	restored, err := restoreRoom(raw, nil, false)
	require.NoError(t, err)
	assert.Equal(t, original.AbandonDeadlineUnixNano, restored.disconnects[target.id].AbandonDeadlineUnixNano)
	time.Sleep(300 * time.Millisecond)
	processQueued(restored)
	assert.True(t, restored.State.Players[restored.playerIndex(target.id)].IsAbandoned)
}

func TestSnapshotRecoveryImmediatelyProcessesExpiredDeadline(t *testing.T) {
	r, clients := newLifecycleRoom(t, 3)
	target := nonHostNonCurrentClient(clients, *r.State.CurrentTurnPlayerID)
	r.processMessage(RoomMessage{ConnectionID: target.conn, PlayerID: target.id, Event: InternalLeaveEvent{ConnectionID: target.conn}})
	raw, err := r.marshalSnapshot()
	require.NoError(t, err)

	time.Sleep(DisconnectAbandonAfter + 10*time.Millisecond)
	restored, err := restoreRoom(raw, nil, false)
	require.NoError(t, err)
	processQueued(restored)
	assert.True(t, restored.State.Players[restored.playerIndex(target.id)].IsAbandoned)
}

func TestSnapshotRecoveryPreservesCurrentTurnGrace(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	current := lifecycleClientByID(t, clients, currentID)
	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: InternalLeaveEvent{ConnectionID: current.conn}})
	require.NotNil(t, r.turnGrace)
	originalGrace := *r.turnGrace
	raw, err := r.marshalSnapshot()
	require.NoError(t, err)

	time.Sleep(10 * time.Millisecond)
	restored, err := restoreRoom(raw, nil, false)
	require.NoError(t, err)
	require.NotNil(t, restored.turnGrace)
	assert.Equal(t, originalGrace.DeadlineUnixNano, restored.turnGrace.DeadlineUnixNano)
	time.Sleep(10 * time.Millisecond)
	processQueued(restored)
	assert.NotEqual(t, current.id, *restored.State.CurrentTurnPlayerID)
}

func TestLifecycleCallbacksCannotMutateResetRoom(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	current := lifecycleClientByID(t, clients, currentID)
	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: InternalLeaveEvent{ConnectionID: current.conn}})
	require.NotNil(t, r.turnGrace)
	staleGrace := *r.turnGrace
	staleAbandon := r.disconnects[current.id]

	host := clients[0]
	hostConnectionID := host.conn
	if host.id == current.id {
		reply := make(chan string, 1)
		hostConnectionID = "host-reset"
		r.processMessage(RoomMessage{ConnectionID: hostConnectionID, Event: InternalJoinEvent{ClientMsgID: "host-reconnect", PlayerName: host.id, UserID: host.id, ConnectionID: hostConnectionID, Outbound: make(chan []byte, 16), ReplyChan: reply}})
		require.Equal(t, host.id, <-reply)
	}
	r.processMessage(RoomMessage{ConnectionID: hostConnectionID, PlayerID: host.id, Event: &ws.ResetToLobbyEvent{BaseClientEvent: ws.BaseClientEvent{Type: "reset_to_lobby", ClientMsgID: "reset"}}})
	before := r.seq
	r.processMessage(RoomMessage{Event: TurnGraceExpiredEvent{PlayerID: staleGrace.PlayerID, Generation: staleGrace.Generation, DeadlineUnixNano: staleGrace.DeadlineUnixNano}})
	r.processMessage(RoomMessage{Event: AbandonEvent{PlayerID: current.id, DeadlineUnixNano: staleAbandon.AbandonDeadlineUnixNano}})

	assert.Equal(t, ws.PhaseLobby, r.State.Phase)
	assert.Equal(t, before, r.seq)
}

func TestResultsLobbyAcknowledgementsAreIndividualAndGateRestart(t *testing.T) {
	r, clients := newLifecycleRoom(t, 3)
	r.State.Phase = ws.PhaseFinished
	r.setCurrentTurn("")

	host := clients[0]
	r.processMessage(RoomMessage{ConnectionID: host.conn, PlayerID: host.id, Event: &ws.ReturnToLobbyEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "return_to_lobby", ClientMsgID: "host-return"},
	}})
	assert.Equal(t, ws.PhaseFinished, r.State.Phase)
	assert.True(t, r.resultsLobby[host.id])
	assert.False(t, r.resultsLobby[clients[1].id])
	assert.Equal(t, []string{host.id}, r.gameStateEventFor(host.id, host.conn).ResultsLobbyPlayerIDs)

	r.processMessage(RoomMessage{ConnectionID: host.conn, PlayerID: host.id, Event: &ws.ResetToLobbyEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "reset_to_lobby", ClientMsgID: "global-reset"},
	}})
	assert.Equal(t, ws.PhaseFinished, r.State.Phase)

	r.processMessage(RoomMessage{ConnectionID: host.conn, PlayerID: host.id, Event: &ws.StartGameEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "start_game", ClientMsgID: "too-early"},
	}})
	assert.Equal(t, ws.PhaseFinished, r.State.Phase)

	for _, client := range clients[1:] {
		r.processMessage(RoomMessage{ConnectionID: client.conn, PlayerID: client.id, Event: &ws.ReturnToLobbyEvent{
			BaseClientEvent: ws.BaseClientEvent{Type: "return_to_lobby", ClientMsgID: "return-" + client.id},
		}})
	}
	require.True(t, r.resultsLobbyReady())
	r.processMessage(RoomMessage{ConnectionID: host.conn, PlayerID: host.id, Event: &ws.StartGameEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "start_game", ClientMsgID: "restart"},
	}})
	assert.Equal(t, ws.PhasePlaying, r.State.Phase)
	assert.Empty(t, r.resultsLobby)
}

func TestResultsLobbyDoesNotWaitForDisconnectedPlayersAndSurvivesRestore(t *testing.T) {
	r, clients := newLifecycleRoom(t, 3)
	r.State.Phase = ws.PhaseFinished
	r.setCurrentTurn("")
	host := clients[0]
	offline := clients[1]
	r.State.Players[r.playerIndex(offline.id)].IsDisconnected = true

	for _, client := range []lifecycleClient{host, clients[2]} {
		r.processMessage(RoomMessage{ConnectionID: client.conn, PlayerID: client.id, Event: &ws.ReturnToLobbyEvent{
			BaseClientEvent: ws.BaseClientEvent{Type: "return_to_lobby", ClientMsgID: "return-" + client.id},
		}})
	}
	require.True(t, r.resultsLobbyReady())

	raw, err := r.marshalSnapshot()
	require.NoError(t, err)
	restored, err := restoreRoom(raw, nil, false)
	require.NoError(t, err)
	assert.Equal(t, ws.PhaseFinished, restored.State.Phase)
	assert.True(t, restored.resultsLobby[host.id])
	assert.True(t, restored.resultsLobby[clients[2].id])
	assert.False(t, restored.resultsLobby[offline.id])
}

func TestSupersededHostCannotMutateLobby(t *testing.T) {
	
	r := newRoom("CONTROLLER", nil, false)
	old := lifecycleClient{id: "host", conn: "old", out: make(chan []byte, 32)}
	newer := lifecycleClient{id: "host", conn: "new", out: make(chan []byte, 32)}
	guest := lifecycleClient{id: "guest", conn: "guest", out: make(chan []byte, 32)}
	for _, client := range []lifecycleClient{old, guest} {
		reply := make(chan string, 1)
		r.processMessage(RoomMessage{ConnectionID: client.conn, Event: InternalJoinEvent{ClientMsgID: "join-" + client.id, PlayerName: client.id, UserID: client.id, ConnectionID: client.conn, Outbound: client.out, ReplyChan: reply}})
		require.Equal(t, client.id, <-reply)
	}
	reply := make(chan string, 1)
	r.processMessage(RoomMessage{ConnectionID: newer.conn, Event: InternalJoinEvent{ClientMsgID: "join-new", PlayerName: newer.id, UserID: newer.id, ConnectionID: newer.conn, Outbound: newer.out, ReplyChan: reply}})
	require.Equal(t, newer.id, <-reply)

	for _, event := range []any{
		&ws.SetConfigEvent{BaseClientEvent: ws.BaseClientEvent{Type: "set_config", ClientMsgID: "old-config"}, DeckCount: 2, WinnerCount: 1},
		&ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{Type: "start_game", ClientMsgID: "old-start"}},
		&ws.ResetToLobbyEvent{BaseClientEvent: ws.BaseClientEvent{Type: "reset_to_lobby", ClientMsgID: "old-reset"}},
		&ws.DestroyRoomEvent{BaseClientEvent: ws.BaseClientEvent{Type: "destroy_room", ClientMsgID: "old-destroy"}},
		&ws.ReturnToLobbyEvent{BaseClientEvent: ws.BaseClientEvent{Type: "return_to_lobby", ClientMsgID: "old-return"}},
		&ws.VoiceSignalEvent{BaseClientEvent: ws.BaseClientEvent{Type: "voice_signal", ClientMsgID: "old-voice"}, Kind: "join"},
		&ws.ReactionEvent{BaseClientEvent: ws.BaseClientEvent{Type: "reaction", ClientMsgID: "old-reaction"}, Emoji: "🔥"},
	} {
		r.processMessage(RoomMessage{ConnectionID: old.conn, PlayerID: old.id, ClientMsg: "old", Event: event})
	}
	assert.Equal(t, ws.PhaseLobby, r.State.Phase)
	assert.Equal(t, 1, r.State.DeckCount)
	controllerRejections := 0
	for {
		select {
		case raw := <-old.out:
			var errEvent ws.ErrorEvent
			if json.Unmarshal(raw, &errEvent) == nil && errEvent.Type == "error" && errEvent.Code == "NOT_ACTIVE_CONTROLLER" {
				controllerRejections++
			}
		default:
			assert.Equal(t, 7, controllerRejections)
			return
		}
	}
}

func TestActiveLeaveBurnsHandRemovesSeatAndTransfersHost(t *testing.T) {
	r, clients := newLifecycleRoom(t, 3)
	host := clients[0]
	clearedUserID := ""
	r.SetUserRoomClearer(func(userID string) { clearedUserID = userID })
	require.NotEmpty(t, r.playerHands[host.id])
	r.processMessage(RoomMessage{ConnectionID: host.conn, PlayerID: host.id, Event: &ws.LeaveRoomEvent{BaseClientEvent: ws.BaseClientEvent{Type: "leave_room", ClientMsgID: "leave"}}})

	assert.Equal(t, 2, len(r.State.Players))
	assert.Equal(t, "b", r.State.HostID)
	assert.Nil(t, r.playerHands[host.id])
	assert.NotEqual(t, host.id, *r.State.CurrentTurnPlayerID)
	assert.Equal(t, host.id, clearedUserID)
}
