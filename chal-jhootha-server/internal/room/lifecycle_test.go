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
	TurnDuration = 60 * time.Millisecond
	ReconnectCushion = 30 * time.Millisecond
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

func TestTurnTimerAutoSkipsActivePlayer(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	next := otherLifecycleClient(clients, currentID)

	require.NotNil(t, r.State.TurnDeadlineUnixMs)
	assert.Equal(t, int(TurnDuration/time.Millisecond), r.State.TurnDurationMs)

	time.Sleep(TurnDuration + 20*time.Millisecond)
	processQueued(r)

	assert.Equal(t, next.id, *r.State.CurrentTurnPlayerID)
}

func TestDisconnectedPlayerTurnTimerContinuesAndAutoSkips(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	current := lifecycleClientByID(t, clients, currentID)
	next := otherLifecycleClient(clients, currentID)

	// Disconnect mid-turn
	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: InternalLeaveEvent{ConnectionID: current.conn}})
	assert.True(t, r.State.Players[r.playerIndex(current.id)].IsDisconnected)
	assert.Equal(t, current.id, *r.State.CurrentTurnPlayerID)

	time.Sleep(TurnDuration + 20*time.Millisecond)
	processQueued(r)

	// Turn has advanced to the next player
	assert.Equal(t, next.id, *r.State.CurrentTurnPlayerID)
	// Disconnected player remains seated with their cards (never deleted/abandoned)
	assert.True(t, r.State.Players[r.playerIndex(current.id)].IsDisconnected)
	assert.NotEmpty(t, r.playerHands[current.id])
}

func TestReconnectWithLessThanCushionGetsBouncedToCushion(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	current := lifecycleClientByID(t, clients, currentID)

	// Disconnect
	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: InternalLeaveEvent{ConnectionID: current.conn}})

	// Wait until less than cushion remaining (60ms - 40ms = 20ms remaining < 30ms cushion)
	time.Sleep(40 * time.Millisecond)

	reply := make(chan string, 1)
	r.processMessage(RoomMessage{
		ConnectionID: "reconnect-conn",
		Event: InternalJoinEvent{
			ClientMsgID:  "reconnect",
			PlayerName:   current.id,
			UserID:       current.id,
			ConnectionID: "reconnect-conn",
			Outbound:     make(chan []byte, 16),
			ReplyChan:    reply,
		},
	})
	require.Equal(t, current.id, <-reply)

	// Cushion should have been applied
	assert.True(t, r.cushionApplied)
	assert.False(t, r.State.Players[r.playerIndex(current.id)].IsDisconnected)
	assert.Equal(t, current.id, *r.State.CurrentTurnPlayerID)

	// At 20ms after reconnect, player is still active because cushion gave them 30ms
	time.Sleep(15 * time.Millisecond)
	processQueued(r)
	assert.Equal(t, current.id, *r.State.CurrentTurnPlayerID)

	// After cushion expires, auto-skip occurs
	time.Sleep(25 * time.Millisecond)
	processQueued(r)
	assert.NotEqual(t, current.id, *r.State.CurrentTurnPlayerID)
}

func TestSubsequentTurnsForDisconnectedPlayerAreInstantlySkipped(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID
	current := lifecycleClientByID(t, clients, currentID)
	other := otherLifecycleClient(clients, currentID)

	// Disconnect 'other' player while it's current's turn
	r.processMessage(RoomMessage{ConnectionID: other.conn, PlayerID: other.id, Event: InternalLeaveEvent{ConnectionID: other.conn}})
	assert.True(t, r.State.Players[r.playerIndex(other.id)].IsDisconnected)

	// Current player plays cards to open stack
	card := r.playerHands[current.id][0]
	r.processMessage(RoomMessage{ConnectionID: current.conn, PlayerID: current.id, Event: &ws.PlayCardsEvent{
		BaseClientEvent: ws.BaseClientEvent{Type: "play_cards", ClientMsgID: "play1"},
		CardIDs:         []string{card.ID},
		Claims:          []ws.ClaimGroup{{Rank: card.Rank, Count: 1}},
		ExpectedSeq:     r.seq,
	}})

	// It was 'other's turn; because 'other' was already disconnected, an instant skip was queued
	processQueued(r)

	// 'other' should have auto-skipped instantly without waiting 60s
	// And 'other' still has their hand and seat!
	assert.True(t, r.State.Players[r.playerIndex(other.id)].IsDisconnected)
	assert.NotEmpty(t, r.playerHands[other.id])
}

func TestDisconnectedOpenerSkipPassesOpenerPrivilege(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	openerID := *r.State.RoundOpenerID
	opener := lifecycleClientByID(t, clients, openerID)
	responder := otherLifecycleClient(clients, openerID)

	// Opener disconnects before playing any cards
	r.processMessage(RoomMessage{ConnectionID: opener.conn, PlayerID: opener.id, Event: InternalLeaveEvent{ConnectionID: opener.conn}})

	// Wait for opener's turn timer to expire
	time.Sleep(TurnDuration + 20*time.Millisecond)
	processQueued(r)

	// Opener privilege passed to responder
	assert.Equal(t, responder.id, *r.State.CurrentTurnPlayerID)
	assert.Equal(t, responder.id, *r.State.RoundOpenerID)
	assert.Zero(t, r.State.StackCount)
}

func TestSnapshotRecoveryPreservesRemainingTurnClock(t *testing.T) {
	r, clients := newLifecycleRoom(t, 2)
	currentID := *r.State.CurrentTurnPlayerID

	raw, err := r.marshalSnapshot()
	require.NoError(t, err)

	restored, err := restoreRoom(raw, nil, false)
	require.NoError(t, err)

	assert.Equal(t, currentID, *restored.State.CurrentTurnPlayerID)
	assert.NotNil(t, restored.State.TurnDeadlineUnixMs)

	// Wait for timer to expire in restored room
	time.Sleep(TurnDuration + 20*time.Millisecond)
	processQueued(restored)

	assert.NotEqual(t, currentID, *restored.State.CurrentTurnPlayerID)
	_ = clients
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
