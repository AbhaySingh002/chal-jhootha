package room_test

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"chal-jhootha-server/internal/room"
	"chal-jhootha-server/internal/teststore"
	"chal-jhootha-server/internal/ws"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func join(t *testing.T, r *room.Room, userID, name, connID string) (playerID string, token string, out chan []byte) {
	t.Helper()
	out = make(chan []byte, 32)
	reply := make(chan string, 1)
	r.Inbox <- room.RoomMessage{
		ConnectionID: connID,
		Event: room.InternalJoinEvent{
			ClientMsgID:  "join-" + userID,
			PlayerName:   name,
			UserID:       userID,
			ConnectionID: connID,
			Outbound:     out,
			ReplyChan:    reply,
		},
	}
	select {
	case playerID = <-reply:
		require.NotEmpty(t, playerID)
	case <-time.After(time.Second):
		t.Fatal("join timeout")
	}
	ack := waitType(t, out, "ack")
	var a ws.AckEvent
	require.NoError(t, json.Unmarshal(ack, &a))
	require.NotNil(t, a.RejoinToken)
	return playerID, *a.RejoinToken, out
}

func waitType(t *testing.T, out chan []byte, typ string) []byte {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case b := <-out:
			var probe struct {
				Type string `json:"type"`
			}
			_ = json.Unmarshal(b, &probe)
			if probe.Type == typ {
				return b
			}
		case <-deadline:
			t.Fatalf("timeout waiting for %s", typ)
		}
	}
}

func drain(out chan []byte) {
	for {
		select {
		case <-out:
		default:
			return
		}
	}
}

func TestRoomCreationAndJoin(t *testing.T) {
	r := room.NewRoom("TEST", nil)
	defer close(r.CloseReq)
	playerID, token, _ := join(t, r, "user-alice", "ALICE", "conn-a")
	assert.Equal(t, "user-alice", playerID)
	assert.NotEmpty(t, token)
}

func TestRoomReconnection(t *testing.T) {
	r := room.NewRoom("RECON", nil)
	defer close(r.CloseReq)
	pID, token, _ := join(t, r, "user-bob", "BOB", "conn-1")

	r.Inbox <- room.RoomMessage{
		ConnectionID: "conn-1", PlayerID: pID,
		Event: room.InternalLeaveEvent{ConnectionID: "conn-1"},
	}
	time.Sleep(30 * time.Millisecond)

	out2 := make(chan []byte, 32)
	reply2 := make(chan string, 1)
	r.Inbox <- room.RoomMessage{
		ConnectionID: "conn-2",
		Event: room.InternalJoinEvent{
			ClientMsgID: "rejoin", PlayerName: "BOB", UserID: "user-bob",
			RejoinToken: &token, ConnectionID: "conn-2", Outbound: out2, ReplyChan: reply2,
		},
	}
	select {
	case got := <-reply2:
		assert.Equal(t, pID, got)
	case <-time.After(time.Second):
		t.Fatal("reconnect timeout")
	}
}

func TestStartAndTurns(t *testing.T) {
	r := room.NewRoom("GAME", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	b, _, outB := join(t, r, "ub", "B", "cb")
	drain(outA)
	drain(outB)

	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "start", Type: "start_game"}}}
	gs := waitType(t, outA, "game_state")
	var state ws.GameStateEvent
	require.NoError(t, json.Unmarshal(gs, &state))
	assert.Equal(t, ws.PhasePlaying, state.Phase)
	assert.NotEmpty(t, state.YourHand)
	assert.NotNil(t, state.CurrentTurnPlayerID)

	turn := *state.CurrentTurnPlayerID
	actorOut := outA
	actorConn := "ca"
	if turn == b {
		waitType(t, outB, "game_state")
		var sb ws.GameStateEvent
		_ = json.Unmarshal(gs, &sb)
		// B's hand is on outB
		gsB := waitTypeMaybe(outB, "game_state")
		if gsB != nil {
			_ = json.Unmarshal(gsB, &state)
		} else {
			state.YourHand = nil
		}
		actorOut = outB
		actorConn = "cb"
		// fetch B snapshot
		r.Inbox <- room.RoomMessage{ConnectionID: actorConn, PlayerID: turn, Event: &ws.SyncStateEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "sync", Type: "sync_state"}}}
		gs = waitType(t, actorOut, "game_state")
		require.NoError(t, json.Unmarshal(gs, &state))
	}

	require.GreaterOrEqual(t, len(state.YourHand), 1)
	rank := state.YourHand[0].Rank
	r.Inbox <- room.RoomMessage{
		ConnectionID: actorConn, PlayerID: turn,
		Event: &ws.PlayCardsEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "play1", Type: "play_cards"},
			CardIDs:         []string{state.YourHand[0].ID},
			ClaimedRank:     &rank,
			ExpectedSeq:     state.Seq,
		},
	}
	played := waitType(t, actorOut, "game_state")
	var after ws.GameStateEvent
	require.NoError(t, json.Unmarshal(played, &after))
	assert.Equal(t, 1, after.StackCount)

	// invalid turn from the player who just acted
	r.Inbox <- room.RoomMessage{
		ConnectionID: actorConn, PlayerID: turn,
		Event: &ws.PlayCardsEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "bad", Type: "play_cards"},
			CardIDs:         []string{"nope"},
			ExpectedSeq:     after.Seq,
		},
	}
	errMsg := waitType(t, actorOut, "error")
	var er ws.ErrorEvent
	require.NoError(t, json.Unmarshal(errMsg, &er))
	assert.Equal(t, "NOT_YOUR_TURN", er.Code)
}

func waitTypeMaybe(out chan []byte, typ string) []byte {
	select {
	case b := <-out:
		return b
	case <-time.After(50 * time.Millisecond):
		return nil
	}
}

type gameClient struct {
	id   string
	conn string
	out  chan []byte
}

func startGame(t *testing.T, r *room.Room, clients []gameClient) {
	t.Helper()
	for _, client := range clients {
		drain(client.out)
	}
	r.Inbox <- room.RoomMessage{
		ConnectionID: clients[0].conn,
		PlayerID:     clients[0].id,
		Event:        &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "start", Type: "start_game"}},
	}
	for _, client := range clients {
		waitType(t, client.out, "game_state")
	}
}

func syncState(t *testing.T, r *room.Room, client gameClient) ws.GameStateEvent {
	t.Helper()
	drain(client.out)
	r.Inbox <- room.RoomMessage{
		ConnectionID: client.conn,
		PlayerID:     client.id,
		Event:        &ws.SyncStateEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "sync-" + client.id, Type: "sync_state"}},
	}
	var state ws.GameStateEvent
	require.NoError(t, json.Unmarshal(waitType(t, client.out, "game_state"), &state))
	return state
}

func waitForNewGameState(t *testing.T, out chan []byte, previousSeq int) ws.GameStateEvent {
	t.Helper()
	for {
		var state ws.GameStateEvent
		require.NoError(t, json.Unmarshal(waitType(t, out, "game_state"), &state))
		if state.Seq > previousSeq {
			return state
		}
	}
}

func clientByID(t *testing.T, clients []gameClient, id string) gameClient {
	t.Helper()
	for _, client := range clients {
		if client.id == id {
			return client
		}
	}
	t.Fatalf("missing client %s", id)
	return gameClient{}
}

func claimsFor(cards []ws.Card) []ws.ClaimGroup {
	ranks := []ws.Rank{"2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"}
	claims := make([]ws.ClaimGroup, 0, (len(cards)+3)/4)
	remaining := len(cards)
	for index := 0; remaining > 0; index++ {
		count := remaining
		if count > 4 {
			count = 4
		}
		claims = append(claims, ws.ClaimGroup{Rank: ranks[index], Count: count})
		remaining -= count
	}
	return claims
}

func bluffyClaimsFor(cards []ws.Card) []ws.ClaimGroup {
	claims := claimsFor(cards)
	actualCounts := make(map[ws.Rank]int)
	for _, card := range cards {
		actualCounts[card.Rank]++
	}
	ranks := []ws.Rank{"2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"}
	for _, rank := range ranks {
		if actualCounts[rank] != claims[0].Count {
			claims[0].Rank = rank
			break
		}
	}
	used := map[ws.Rank]bool{claims[0].Rank: true}
	for index := 1; index < len(claims); index++ {
		for _, rank := range ranks {
			if !used[rank] {
				claims[index].Rank = rank
				used[rank] = true
				break
			}
		}
	}
	return claims
}

func playCards(t *testing.T, r *room.Room, client gameClient, cards []ws.Card, claims []ws.ClaimGroup) ws.GameStateEvent {
	t.Helper()
	state := syncState(t, r, client)
	require.Equal(t, client.id, *state.CurrentTurnPlayerID)
	// A state broadcast from the action immediately before sync_state can race
	// with the sync reply. It represents the same authoritative state, so clear
	// a duplicate before waiting for the play's own resulting state.
	drain(client.out)
	ids := make([]string, len(cards))
	for i, card := range cards {
		ids[i] = card.ID
	}
	r.Inbox <- room.RoomMessage{
		ConnectionID: client.conn,
		PlayerID:     client.id,
		Event: &ws.PlayCardsEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: fmt.Sprintf("play-%s-%d", client.id, state.Seq), Type: "play_cards"},
			CardIDs:         ids,
			Claims:          claims,
			ExpectedSeq:     state.Seq,
		},
	}
	return waitForNewGameState(t, client.out, state.Seq)
}

func skipTurn(t *testing.T, r *room.Room, client gameClient) {
	t.Helper()
	state := syncState(t, r, client)
	require.Equal(t, client.id, *state.CurrentTurnPlayerID)
	r.Inbox <- room.RoomMessage{
		ConnectionID: client.conn,
		PlayerID:     client.id,
		Event:        &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "skip-" + client.id, Type: "skip"}, ExpectedSeq: state.Seq},
	}
}

func challengeTurn(t *testing.T, r *room.Room, client gameClient) {
	t.Helper()
	state := syncState(t, r, client)
	require.Equal(t, client.id, *state.CurrentTurnPlayerID)
	r.Inbox <- room.RoomMessage{
		ConnectionID: client.conn,
		PlayerID:     client.id,
		Event:        &ws.ChallengeEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "challenge-" + client.id, Type: "challenge"}, ExpectedSeq: state.Seq},
	}
}

func newPlayingRoom(t *testing.T, code string, count int) (*room.Room, []gameClient) {
	t.Helper()
	r := room.NewRoom(code, nil)
	t.Cleanup(func() { close(r.CloseReq) })
	clients := make([]gameClient, 0, count)
	for i := 0; i < count; i++ {
		id := fmt.Sprintf("player-%d", i+1)
		conn := fmt.Sprintf("conn-%d", i+1)
		playerID, _, out := join(t, r, id, fmt.Sprintf("P%d", i+1), conn)
		clients = append(clients, gameClient{id: playerID, conn: conn, out: out})
	}
	startGame(t, r, clients)
	return r, clients
}

func TestOpeningComboAcceptsBluffAndSetsFinalRank(t *testing.T) {
	r, clients := newPlayingRoom(t, "COMBO-BLUFF", 2)
	state := syncState(t, r, clients[0])
	actor := clientByID(t, clients, *state.CurrentTurnPlayerID)
	actorState := syncState(t, r, actor)
	played := actorState.YourHand[:5]

	allRanks := []ws.Rank{"2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"}
	playedRanks := make(map[ws.Rank]bool)
	for _, card := range played {
		playedRanks[card.Rank] = true
	}
	missingRanks := make([]ws.Rank, 0, 2)
	for _, rank := range allRanks {
		if !playedRanks[rank] {
			missingRanks = append(missingRanks, rank)
		}
	}
	require.GreaterOrEqual(t, len(missingRanks), 2)
	claims := []ws.ClaimGroup{{Rank: missingRanks[0], Count: 4}, {Rank: missingRanks[1], Count: 1}}

	after := playCards(t, r, actor, played, claims)
	require.NotNil(t, after.TopPlay)
	assert.Equal(t, claims, after.TopPlay.Claims)
	require.NotNil(t, after.ClaimedRank)
	assert.Equal(t, missingRanks[1], *after.ClaimedRank)
}

func TestLaterPlayCannotDeclareAnotherCombo(t *testing.T) {
	r, clients := newPlayingRoom(t, "COMBO-LATER", 2)
	state := syncState(t, r, clients[0])
	opener := clientByID(t, clients, *state.CurrentTurnPlayerID)
	openerState := syncState(t, r, opener)
	afterOpening := playCards(t, r, opener, openerState.YourHand[:1], []ws.ClaimGroup{{Rank: "A", Count: 1}})

	nextPlayer := clientByID(t, clients, *afterOpening.CurrentTurnPlayerID)
	nextState := syncState(t, r, nextPlayer)
	cards := nextState.YourHand[:5]
	r.Inbox <- room.RoomMessage{
		ConnectionID: nextPlayer.conn,
		PlayerID:     nextPlayer.id,
		ClientMsg:    "later-combo",
		Event: &ws.PlayCardsEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "later-combo", Type: "play_cards"},
			CardIDs:         []string{cards[0].ID, cards[1].ID, cards[2].ID, cards[3].ID, cards[4].ID},
			Claims:          []ws.ClaimGroup{{Rank: "K", Count: 4}, {Rank: "3", Count: 1}},
			ExpectedSeq:     nextState.Seq,
		},
	}

	var rejected ws.ActionRejectedEvent
	require.NoError(t, json.Unmarshal(waitType(t, nextPlayer.out, "action_rejected"), &rejected))
	assert.Equal(t, "INVALID_CLAIM", rejected.Code)
}

func TestMidGameReconnectRestoresPrivateHandAndPresence(t *testing.T) {
	r, clients := newPlayingRoom(t, "MID_RECON", 2)
	target := clients[1]
	before := syncState(t, r, target)
	drain(clients[0].out)

	r.Inbox <- room.RoomMessage{ConnectionID: target.conn, PlayerID: target.id, Event: room.InternalLeaveEvent{ConnectionID: target.conn}}
	var disconnected ws.PlayerDisconnectedEvent
	require.NoError(t, json.Unmarshal(waitType(t, clients[0].out, "player_disconnected"), &disconnected))
	assert.Equal(t, target.id, disconnected.PlayerID)

	out := make(chan []byte, 32)
	reply := make(chan string, 1)
	r.Inbox <- room.RoomMessage{ConnectionID: "reconnect", Event: room.InternalJoinEvent{
		ClientMsgID: "rejoin", PlayerName: "P2", UserID: target.id, ConnectionID: "reconnect", Outbound: out, ReplyChan: reply,
	}}
	require.Equal(t, target.id, <-reply)
	waitType(t, out, "ack")
	var restored ws.GameStateEvent
	require.NoError(t, json.Unmarshal(waitType(t, out, "game_state"), &restored))
	assert.Equal(t, before.YourHand, restored.YourHand)
	assert.Equal(t, before.CurrentTurnPlayerID, restored.CurrentTurnPlayerID)
	assert.Equal(t, before.StackCount, restored.StackCount)
	for _, player := range restored.Players {
		if player.ID == target.id {
			assert.False(t, player.IsDisconnected)
		}
	}
}

func TestDisconnectedCurrentPlayerRemainsSeatedDuringTurnGrace(t *testing.T) {
	r, clients := newPlayingRoom(t, "AUTO_SKIP", 2)
	state := syncState(t, r, clients[0])
	target := clientByID(t, clients, *state.CurrentTurnPlayerID)
	observer := clientByID(t, clients, clients[0].id)
	if observer.id == target.id {
		observer = clients[1]
	}
	drain(observer.out)
	r.Inbox <- room.RoomMessage{ConnectionID: target.conn, PlayerID: target.id, Event: room.InternalLeaveEvent{ConnectionID: target.conn}}
	waitType(t, observer.out, "player_disconnected")
	after := syncState(t, r, observer)
	assert.Equal(t, target.id, *after.CurrentTurnPlayerID)
	for _, player := range after.Players {
		if player.ID == target.id {
			assert.True(t, player.IsDisconnected)
		}
	}
}

func TestLastCardAllSkipsKeepsCompletedMatchVisible(t *testing.T) {
	r, clients := newPlayingRoom(t, "LAST_SKIP", 3)
	state := syncState(t, r, clients[0])
	winner := clientByID(t, clients, *state.CurrentTurnPlayerID)
	hand := syncState(t, r, winner).YourHand
	afterLastPlay := playCards(t, r, winner, hand, claimsFor(hand))
	firstResponder := clientByID(t, clients, *afterLastPlay.CurrentTurnPlayerID)
	skipTurn(t, r, firstResponder)
	afterFirstResponse := syncState(t, r, winner)
	secondResponder := clientByID(t, clients, *afterFirstResponse.CurrentTurnPlayerID)
	skipTurn(t, r, secondResponder)

	var won ws.PlayerWonEvent
	require.NoError(t, json.Unmarshal(waitType(t, winner.out, "player_won"), &won))
	assert.Equal(t, winner.id, won.PlayerID)
	assert.True(t, won.GameOver)
	completed := syncState(t, r, winner)
	assert.Equal(t, ws.PhaseFinished, completed.Phase)
	assert.Equal(t, []string{winner.id}, completed.Winners)
	assert.Empty(t, completed.ResultsLobbyPlayerIDs)
}

func TestLastCardTruthfulCalloutWinsAndBluffCalloutDoesNot(t *testing.T) {
	t.Run("truthful", func(t *testing.T) {
		r, clients := newPlayingRoom(t, "LAST_TRUTH", 2)
		state := syncState(t, r, clients[0])
		opener := clientByID(t, clients, *state.CurrentTurnPlayerID)
		other := clientByID(t, clients, clients[0].id)
		if other.id == opener.id {
			other = clients[1]
		}
		otherState := syncState(t, r, other)
		finalCard := otherState.YourHand[len(otherState.YourHand)-1]

		playCards(t, r, opener, syncState(t, r, opener).YourHand[:1], []ws.ClaimGroup{{Rank: finalCard.Rank, Count: 1}})
		playCards(t, r, other, otherState.YourHand[:len(otherState.YourHand)-1], nil)
		skipTurn(t, r, opener)
		afterLastPlay := playCards(t, r, other, []ws.Card{finalCard}, nil)
		assert.Equal(t, opener.id, *afterLastPlay.CurrentTurnPlayerID)
		challengeTurn(t, r, opener)
		var won ws.PlayerWonEvent
		require.NoError(t, json.Unmarshal(waitType(t, other.out, "player_won"), &won))
		assert.Equal(t, other.id, won.PlayerID)
		assert.True(t, won.GameOver)
	})

	t.Run("bluff", func(t *testing.T) {
		r, clients := newPlayingRoom(t, "LAST_BLUFF", 2)
		state := syncState(t, r, clients[0])
		liar := clientByID(t, clients, *state.CurrentTurnPlayerID)
		other := clientByID(t, clients, clients[0].id)
		if other.id == liar.id {
			other = clients[1]
		}
		hand := syncState(t, r, liar).YourHand
		playCards(t, r, liar, hand, bluffyClaimsFor(hand))
		challengeTurn(t, r, other)
		var result ws.ChallengeResultEvent
		require.NoError(t, json.Unmarshal(waitType(t, other.out, "challenge_result"), &result))
		assert.True(t, result.WasBluff)
		assert.Equal(t, liar.id, result.PlayedByID)
		after := syncState(t, r, other)
		assert.Equal(t, ws.PhasePlaying, after.Phase)
		assert.Nil(t, after.PendingFinishID)
		for _, player := range after.Players {
			if player.ID == liar.id {
				assert.Greater(t, player.HandCount, 0)
			}
		}
	})
}

func TestLastCardCoveringAddConfirmsImmediately(t *testing.T) {
	r, clients := newPlayingRoom(t, "LAST_COVER", 3)
	state := syncState(t, r, clients[0])
	winner := clientByID(t, clients, *state.CurrentTurnPlayerID)
	hand := syncState(t, r, winner).YourHand
	afterLastPlay := playCards(t, r, winner, hand, claimsFor(hand))
	followUp := clientByID(t, clients, *afterLastPlay.CurrentTurnPlayerID)
	followUpState := syncState(t, r, followUp)
	require.NotNil(t, followUpState.ClaimedRank)
	coverCard := followUpState.YourHand[0]
	playCards(t, r, followUp, []ws.Card{coverCard}, nil)

	var won ws.PlayerWonEvent
	require.NoError(t, json.Unmarshal(waitType(t, winner.out, "player_won"), &won))
	assert.Equal(t, winner.id, won.PlayerID)
	assert.True(t, won.GameOver)
	completed := syncState(t, r, followUp)
	assert.Equal(t, ws.PhaseFinished, completed.Phase)
	require.NotNil(t, completed.TopPlay)
	assert.Equal(t, followUp.id, completed.TopPlay.PlayerID)
}

func TestLastCardResponseLapSurvivesSnapshotRestore(t *testing.T) {
	r, clients := newPlayingRoom(t, "LAST_RESTORE", 3)
	state := syncState(t, r, clients[0])
	winner := clientByID(t, clients, *state.CurrentTurnPlayerID)
	hand := syncState(t, r, winner).YourHand
	afterLastPlay := playCards(t, r, winner, hand, claimsFor(hand))
	firstResponder := clientByID(t, clients, *afterLastPlay.CurrentTurnPlayerID)
	skipTurn(t, r, firstResponder)
	afterFirstResponse := syncState(t, r, winner)

	raw, err := r.Snapshot(context.Background())
	require.NoError(t, err)
	restored, err := room.RestoreRoom(raw, nil)
	require.NoError(t, err)
	defer close(restored.CloseReq)

	remaining := clientByID(t, clients, *afterFirstResponse.CurrentTurnPlayerID)
	out := make(chan []byte, 32)
	reply := make(chan string, 1)
	restored.Inbox <- room.RoomMessage{ConnectionID: "restore-remaining", Event: room.InternalJoinEvent{
		ClientMsgID: "restore-join", PlayerName: "P", UserID: remaining.id, ConnectionID: "restore-remaining", Outbound: out, ReplyChan: reply,
	}}
	require.Equal(t, remaining.id, <-reply)
	waitType(t, out, "ack")
	var restoredState ws.GameStateEvent
	require.NoError(t, json.Unmarshal(waitType(t, out, "game_state"), &restoredState))
	require.NotNil(t, restoredState.PendingFinishID)
	assert.Equal(t, winner.id, *restoredState.PendingFinishID)
	assert.Equal(t, remaining.id, *restoredState.CurrentTurnPlayerID)

	restored.Inbox <- room.RoomMessage{ConnectionID: "restore-remaining", PlayerID: remaining.id, Event: &ws.SkipEvent{
		BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "restore-skip", Type: "skip"}, ExpectedSeq: restoredState.Seq,
	}}
	var won ws.PlayerWonEvent
	require.NoError(t, json.Unmarshal(waitType(t, out, "player_won"), &won))
	assert.Equal(t, winner.id, won.PlayerID)
}

func TestMatchEndingAbandonKeepsCompletedMatchVisible(t *testing.T) {
	r, clients := newPlayingRoom(t, "ABANDON_FINISH", 2)
	state := syncState(t, r, clients[0])
	abandoned := clientByID(t, clients, clients[0].id)
	if abandoned.id == *state.CurrentTurnPlayerID {
		abandoned = clients[1]
	}
	observer := clientByID(t, clients, clients[0].id)
	if observer.id == abandoned.id {
		observer = clients[1]
	}
	drain(observer.out)
	r.Inbox <- room.RoomMessage{ConnectionID: abandoned.conn, PlayerID: abandoned.id, Event: room.InternalLeaveEvent{ConnectionID: abandoned.conn}}
	waitType(t, observer.out, "player_disconnected")
	r.Inbox <- room.RoomMessage{PlayerID: abandoned.id, Event: room.AbandonEvent{PlayerID: abandoned.id}}
	completed := syncState(t, r, observer)
	assert.Equal(t, ws.PhaseFinished, completed.Phase)
}

func TestDuplicateAction(t *testing.T) {
	r := room.NewRoom("DUP", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	_, _, outB := join(t, r, "ub", "B", "cb")
	drain(outA)
	drain(outB)
	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "start", Type: "start_game"}}}
	gs := waitType(t, outA, "game_state")
	var state ws.GameStateEvent
	_ = json.Unmarshal(gs, &state)
	turn := *state.CurrentTurnPlayerID
	conn := "ca"
	out := outA
	if turn != a {
		conn = "cb"
		out = outB
		r.Inbox <- room.RoomMessage{ConnectionID: conn, PlayerID: turn, Event: &ws.SyncStateEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "s", Type: "sync_state"}}}
		gs = waitType(t, out, "game_state")
		_ = json.Unmarshal(gs, &state)
	}
	rank := state.YourHand[0].Rank
	play := &ws.PlayCardsEvent{
		BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "same-play", Type: "play_cards"},
		CardIDs:         []string{state.YourHand[0].ID},
		ClaimedRank:     &rank,
		ExpectedSeq:     state.Seq,
	}
	r.Inbox <- room.RoomMessage{ConnectionID: conn, PlayerID: turn, Event: play}
	waitType(t, out, "game_state")
	r.Inbox <- room.RoomMessage{ConnectionID: conn, PlayerID: turn, Event: play}
	ack := waitType(t, out, "ack")
	var aev ws.AckEvent
	require.NoError(t, json.Unmarshal(ack, &aev))
	assert.Equal(t, "same-play", aev.ClientMsgID)
}

func TestMultiDeviceController(t *testing.T) {
	r := room.NewRoom("DEV", nil)
	defer close(r.CloseReq)
	pID, _, out1 := join(t, r, "u1", "ONE", "c1")
	out2 := make(chan []byte, 32)
	reply := make(chan string, 1)
	r.Inbox <- room.RoomMessage{
		ConnectionID: "c2",
		Event: room.InternalJoinEvent{
			ClientMsgID: "d2", PlayerName: "ONE", UserID: "u1",
			ConnectionID: "c2", Outbound: out2, ReplyChan: reply,
		},
	}
	<-reply
	sup := waitType(t, out1, "device_superseded")
	assert.Contains(t, string(sup), "device_superseded")

	_, _, _ = join(t, r, "u2", "TWO", "c3")
	r.Inbox <- room.RoomMessage{ConnectionID: "c2", PlayerID: pID, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "st", Type: "start_game"}}}
	// old device action rejected
	r.Inbox <- room.RoomMessage{
		ConnectionID: "c1", PlayerID: pID,
		Event: &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "skip-old", Type: "skip"}, ExpectedSeq: 1},
	}
	errMsg := waitType(t, out1, "error")
	var er ws.ErrorEvent
	_ = json.Unmarshal(errMsg, &er)
	assert.Equal(t, "NOT_ACTIVE_CONTROLLER", er.Code)
}

func TestPendingFinishAndWinnerCount(t *testing.T) {
	r := room.NewRoom("WIN", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	_, _, outB := join(t, r, "ub", "B", "cb")
	drain(outA)
	drain(outB)
	r.Inbox <- room.RoomMessage{
		ConnectionID: "ca", PlayerID: a,
		Event: &ws.SetConfigEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "cfg", Type: "set_config"}, DeckCount: 1, WinnerCount: 1},
	}
	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "st", Type: "start_game"}}}
	waitType(t, outA, "room_state")
	gs := waitType(t, outA, "game_state")
	var state ws.GameStateEvent
	require.NoError(t, json.Unmarshal(gs, &state))
	assert.Equal(t, 1, state.WinnerCount)
}

func TestWinnerCountUnlocksWhenReturningToLobby(t *testing.T) {
	r := room.NewRoom("LOCKED", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	_, _, outB := join(t, r, "ub", "B", "cb")
	_, _, outC := join(t, r, "uc", "C", "cc")
	drain(outA)
	drain(outB)
	drain(outC)

	r.Inbox <- room.RoomMessage{
		ConnectionID: "ca", PlayerID: a,
		Event: &ws.SetConfigEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "cfg-locked", Type: "set_config"}, DeckCount: 2, WinnerCount: 2},
	}
	roomState := waitType(t, outA, "room_state")
	var configured ws.RoomStateEvent
	require.NoError(t, json.Unmarshal(roomState, &configured))
	require.Equal(t, 2, configured.WinnerCount)
	require.False(t, configured.WinnerCountLocked)

	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "start-locked", Type: "start_game"}}}
	gameState := waitType(t, outA, "game_state")
	var started ws.GameStateEvent
	require.NoError(t, json.Unmarshal(gameState, &started))
	require.Equal(t, 2, started.WinnerCount)
	require.True(t, started.WinnerCountLocked)

	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.ResetToLobbyEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "reset-locked", Type: "reset_to_lobby"}}}
	roomState = waitType(t, outA, "room_state")
	var replayLobby ws.RoomStateEvent
	require.NoError(t, json.Unmarshal(roomState, &replayLobby))
	require.Equal(t, 2, replayLobby.WinnerCount)
	require.False(t, replayLobby.WinnerCountLocked)

	r.Inbox <- room.RoomMessage{
		ConnectionID: "ca", PlayerID: a,
		Event: &ws.SetConfigEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "raise-locked", Type: "set_config"}, DeckCount: 3, WinnerCount: 1},
	}
	roomState = waitType(t, outA, "room_state")
	var reconfigured ws.RoomStateEvent
	require.NoError(t, json.Unmarshal(roomState, &reconfigured))
	require.Equal(t, 3, reconfigured.DeckCount)
	require.Equal(t, 1, reconfigured.WinnerCount)

	raw, err := r.Snapshot(context.Background())
	require.NoError(t, err)
	restored, err := room.RestoreRoom(raw, nil)
	require.NoError(t, err)
	defer close(restored.CloseReq)
	require.False(t, restored.State.WinnerCountLocked)
	require.Equal(t, 1, restored.State.WinnerCount)
}

func TestSnapshotRestore(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()

	m := room.NewManager(st)
	r := m.GetOrCreateRoom("SNAP")
	_, _, _ = join(t, r, "ua", "A", "ca")
	time.Sleep(50 * time.Millisecond)
	require.True(t, m.HasRoom("SNAP"))

	raw, err := r.Snapshot(context.Background())
	require.NoError(t, err)
	close(r.CloseReq)
	time.Sleep(20 * time.Millisecond)

	m2 := room.NewManager(st)
	m2.Restore()
	r2, ok := m2.GetRoom("SNAP")
	require.True(t, ok)
	require.Equal(t, 1, len(r2.State.Players))
	assert.True(t, r2.State.Players[0].IsDisconnected)
	_ = raw
}

func TestUnauthorizedAndMalformedHandledByRoom(t *testing.T) {
	r := room.NewRoom("UA", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "st", Type: "start_game"}}}
	errMsg := waitType(t, outA, "error")
	var er ws.ErrorEvent
	_ = json.Unmarshal(errMsg, &er)
	assert.Equal(t, "NOT_ENOUGH_PLAYERS", er.Code)
}

func TestRoomManagerJanitor(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rm := room.NewManager(nil)
	rm.StartJanitor(ctx)
	r := rm.GetOrCreateRoom("ROOM1")
	assert.NotNil(t, r)
	rm.DeleteRoom("ROOM1")
	assert.False(t, rm.HasRoom("ROOM1"))
}

func TestDeleteRoomDiscardsQueuedSnapshot(t *testing.T) {
	st := teststore.Open(t)
	m := room.NewManager(st)
	r := m.GetOrCreateRoom("DELETE_QUEUE")
	_, _, _ = join(t, r, "delete-user", "DELETE", "delete-conn")

	// Do not start the persistence worker yet: the join has queued a snapshot,
	// mirroring a snapshot that was queued just before the final player left.
	m.DeleteRoom("DELETE_QUEUE")
	require.NoError(t, m.FlushPersistence(context.Background()))

	rows, err := st.LoadAllRooms()
	require.NoError(t, err)
	for _, row := range rows {
		assert.NotEqual(t, "DELETE_QUEUE", row.Code)
	}
}

func TestExplicitLobbyLeaveTransfersHost(t *testing.T) {
	r := room.NewRoom("LEAVE", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	b, _, outB := join(t, r, "ub", "B", "cb")
	drain(outA)
	drain(outB)

	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, ClientMsg: "leave", Event: &ws.LeaveRoomEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "leave", Type: "leave_room"}}}
	left := waitType(t, outA, "room_left")
	var leftEvent ws.RoomLeftEvent
	require.NoError(t, json.Unmarshal(left, &leftEvent))
	assert.Equal(t, "LEAVE", leftEvent.RoomCode)

	roomState := waitType(t, outB, "room_state")
	var state ws.RoomStateEvent
	require.NoError(t, json.Unmarshal(roomState, &state))
	assert.Equal(t, b, state.HostID)
	assert.Len(t, state.Players, 1)
}

func TestSkipAroundBurn(t *testing.T) {
	r := room.NewRoom("BURN", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	b, _, outB := join(t, r, "ub", "B", "cb")
	drain(outA)
	drain(outB)
	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "st", Type: "start_game"}}}
	gs := waitType(t, outA, "game_state")
	var state ws.GameStateEvent
	_ = json.Unmarshal(gs, &state)
	turn := *state.CurrentTurnPlayerID
	conn, pid, out := "ca", a, outA
	if turn != a {
		conn, pid, out = "cb", b, outB
		r.Inbox <- room.RoomMessage{ConnectionID: conn, PlayerID: pid, Event: &ws.SyncStateEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "s", Type: "sync_state"}}}
		gs = waitType(t, out, "game_state")
		_ = json.Unmarshal(gs, &state)
	}
	rank := state.YourHand[0].Rank
	r.Inbox <- room.RoomMessage{
		ConnectionID: conn, PlayerID: pid,
		Event: &ws.PlayCardsEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "p", Type: "play_cards"},
			CardIDs:         []string{state.YourHand[0].ID}, ClaimedRank: &rank, ExpectedSeq: state.Seq,
		},
	}
	waitType(t, out, "game_state")

	// other player skips — not opener, no burn
	other, otherConn, otherOut := b, "cb", outB
	if pid == b {
		other, otherConn, otherOut = a, "ca", outA
	}
	drain(otherOut)
	r.Inbox <- room.RoomMessage{ConnectionID: otherConn, PlayerID: other, Event: &ws.SyncStateEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "s2", Type: "sync_state"}}}
	gs = waitType(t, otherOut, "game_state")
	_ = json.Unmarshal(gs, &state)
	r.Inbox <- room.RoomMessage{
		ConnectionID: otherConn, PlayerID: other,
		Event: &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "sk", Type: "skip"}, ExpectedSeq: state.Seq},
	}
	next := waitType(t, otherOut, "game_state")
	_ = json.Unmarshal(next, &state)
	assert.NotContains(t, string(next), `"type":"stack_burned"`)

	// opener skip burns
	drain(out)
	r.Inbox <- room.RoomMessage{ConnectionID: conn, PlayerID: pid, Event: &ws.SyncStateEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "s3", Type: "sync_state"}}}
	gs = waitType(t, out, "game_state")
	_ = json.Unmarshal(gs, &state)
	if state.CurrentTurnPlayerID != nil && *state.CurrentTurnPlayerID == pid && state.RoundOpenerID != nil && *state.RoundOpenerID == pid {
		r.Inbox <- room.RoomMessage{
			ConnectionID: conn, PlayerID: pid,
			Event: &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "burn", Type: "skip"}, ExpectedSeq: state.Seq},
		}
		burned := waitType(t, out, "stack_burned")
		assert.Contains(t, string(burned), "stack_burned")
	}
}

func TestStateSyncAndStaleActionSeq(t *testing.T) {
	r := room.NewRoom("SYNC_TEST", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	b, _, outB := join(t, r, "ub", "B", "cb")
	_ = b
	drain(outA)
	drain(outB)

	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "st", Type: "start_game"}}}
	gs := waitType(t, outA, "game_state")
	var state ws.GameStateEvent
	require.NoError(t, json.Unmarshal(gs, &state))

	// Sync request returns current state
	r.Inbox <- room.RoomMessage{ConnectionID: "ca", PlayerID: a, Event: &ws.SyncStateEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "sync1", Type: "sync_state"}}}
	syncGs := waitType(t, outA, "game_state")
	var syncState ws.GameStateEvent
	require.NoError(t, json.Unmarshal(syncGs, &syncState))
	assert.Equal(t, state.Seq, syncState.Seq)
	assert.Equal(t, ws.PhasePlaying, syncState.Phase)

	// Action with stale expectedSeq is rejected
	turn := *state.CurrentTurnPlayerID
	conn := "ca"
	out := outA
	if turn != a {
		conn = "cb"
		out = outB
	}
	r.Inbox <- room.RoomMessage{
		ConnectionID: conn, PlayerID: turn,
		Event: &ws.SkipEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "stale_skip", Type: "skip"}, ExpectedSeq: state.Seq - 1},
	}
	errB := waitType(t, out, "error")
	var errEv ws.ErrorEvent
	require.NoError(t, json.Unmarshal(errB, &errEv))
	assert.Equal(t, "STALE_ACTION", errEv.Code)
}

func TestMultiWinnerSpectatorFlow(t *testing.T) {
	r := room.NewRoom("MULTI_WIN", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "A", "ca")
	b, _, outB := join(t, r, "ub", "B", "cb")
	c, _, outC := join(t, r, "uc", "C", "cc")
	_ = b
	_ = c
	drain(outA)
	drain(outB)
	drain(outC)

	// Configure winner count = 2
	r.Inbox <- room.RoomMessage{
		ConnectionID: "ca", PlayerID: a,
		Event: &ws.SetConfigEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "cfg", Type: "set_config"}, DeckCount: 1, WinnerCount: 2},
	}
	r.Inbox <- room.RoomMessage{
		ConnectionID: "ca", PlayerID: a,
		Event: &ws.StartGameEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "start", Type: "start_game"}},
	}
	gs := waitType(t, outA, "game_state")
	var state ws.GameStateEvent
	require.NoError(t, json.Unmarshal(gs, &state))
	assert.Equal(t, 2, state.WinnerCount)
	assert.Equal(t, 3, len(state.Players))
	assert.Equal(t, ws.RoleActive, state.YourRole)
}

func TestTableReactionsBroadcastAndRateLimit(t *testing.T) {
	r := room.NewRoom("REACT", nil)
	defer close(r.CloseReq)
	a, _, outA := join(t, r, "ua", "ALICE", "ca")
	_, _, outB := join(t, r, "ub", "BOB", "cb")
	drain(outA)
	drain(outB)

	r.Inbox <- room.RoomMessage{
		ConnectionID: "ca",
		PlayerID:     a,
		ClientMsg:    "reaction-1",
		Event: &ws.ReactionEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "reaction-1", Type: "reaction"},
			Emoji:           "🔥",
		},
	}
	broadcast := waitType(t, outB, "reaction")
	var reaction ws.ReactionBroadcast
	require.NoError(t, json.Unmarshal(broadcast, &reaction))
	assert.Equal(t, "🔥", reaction.Emoji)
	assert.Equal(t, a, reaction.PlayerID)
	assert.Equal(t, "ALICE", reaction.PlayerName)

	r.Inbox <- room.RoomMessage{
		ConnectionID: "ca",
		PlayerID:     a,
		ClientMsg:    "reaction-too-fast",
		Event: &ws.ReactionEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "reaction-too-fast", Type: "reaction"},
			Emoji:           "😂",
		},
	}
	rateLimited := waitType(t, outA, "error")
	var rateLimitError ws.ErrorEvent
	require.NoError(t, json.Unmarshal(rateLimited, &rateLimitError))
	assert.Equal(t, "REACTION_RATE_LIMITED", rateLimitError.Code)

	r.Inbox <- room.RoomMessage{
		ConnectionID: "cb",
		PlayerID:     "ub",
		ClientMsg:    "reaction-invalid",
		Event: &ws.ReactionEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "reaction-invalid", Type: "reaction"},
			Emoji:           "🚫",
		},
	}
	invalid := waitType(t, outB, "error")
	var invalidError ws.ErrorEvent
	require.NoError(t, json.Unmarshal(invalid, &invalidError))
	assert.Equal(t, "INVALID_REACTION", invalidError.Code)
}

func TestVoiceIsAvailableThroughEightPlayersAndBlockedAtNine(t *testing.T) {
	eight := room.NewRoom("VOICE8", nil)
	defer close(eight.CloseReq)
	var firstID string
	var secondOut chan []byte
	for i := 1; i <= room.MaxVoiceParticipants; i++ {
		id, _, out := join(t, eight, fmt.Sprintf("voice-%d", i), "P", fmt.Sprintf("conn-%d", i))
		if i == 1 {
			firstID = id
		}
		if i == 2 {
			secondOut = out
		}
	}
	drain(secondOut)
	eight.Inbox <- room.RoomMessage{
		ConnectionID: "conn-1",
		PlayerID:     firstID,
		ClientMsg:    "voice-eight",
		Event: &ws.VoiceSignalEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "voice-eight", Type: "voice_signal"},
			Kind:            "join",
		},
	}
	allowed := waitType(t, secondOut, "voice_signal")
	assert.Contains(t, string(allowed), `"kind":"join"`)

	nine := room.NewRoom("VOICE9", nil)
	defer close(nine.CloseReq)
	var firstNineID string
	var firstOut chan []byte
	for i := 1; i <= room.MaxVoiceParticipants+1; i++ {
		id, _, out := join(t, nine, fmt.Sprintf("nine-%d", i), "P", fmt.Sprintf("nine-conn-%d", i))
		if i == 1 {
			firstNineID, firstOut = id, out
		}
	}
	drain(firstOut)
	nine.Inbox <- room.RoomMessage{
		ConnectionID: "nine-conn-1",
		PlayerID:     firstNineID,
		ClientMsg:    "voice-nine",
		Event: &ws.VoiceSignalEvent{
			BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "voice-nine", Type: "voice_signal"},
			Kind:            "join",
		},
	}
	rejected := waitType(t, firstOut, "error")
	var voiceError ws.ErrorEvent
	require.NoError(t, json.Unmarshal(rejected, &voiceError))
	assert.Equal(t, "VOICE_PLAYER_LIMIT", voiceError.Code)
}
