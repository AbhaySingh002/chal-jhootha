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

func TestWinnerCountLocksAcrossLobbyReplayAndSnapshot(t *testing.T) {
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
	require.True(t, replayLobby.WinnerCountLocked)

	r.Inbox <- room.RoomMessage{
		ConnectionID: "ca", PlayerID: a,
		Event: &ws.SetConfigEvent{BaseClientEvent: ws.BaseClientEvent{ClientMsgID: "raise-locked", Type: "set_config"}, DeckCount: 3, WinnerCount: 1},
	}
	errRaw := waitType(t, outA, "error")
	var errEvent ws.ErrorEvent
	require.NoError(t, json.Unmarshal(errRaw, &errEvent))
	require.Equal(t, "WINNER_COUNT_LOCKED", errEvent.Code)

	raw, err := r.MarshalSnapshot()
	require.NoError(t, err)
	restored, err := room.RestoreRoom(raw, nil)
	require.NoError(t, err)
	defer close(restored.CloseReq)
	require.True(t, restored.State.WinnerCountLocked)
	require.Equal(t, 2, restored.State.WinnerCount)
}

func TestSnapshotRestore(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()

	m := room.NewManager(st)
	r := m.GetOrCreateRoom("SNAP")
	_, _, _ = join(t, r, "ua", "A", "ca")
	time.Sleep(50 * time.Millisecond)
	require.True(t, m.HasRoom("SNAP"))

	raw, err := r.MarshalSnapshot()
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
