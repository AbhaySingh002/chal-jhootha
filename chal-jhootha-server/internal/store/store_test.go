package store_test

import (
	"errors"
	"testing"

	"chal-jhootha-server/internal/store"
	"chal-jhootha-server/internal/teststore"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestProfilesFriendshipsAndCompletedMatchStats(t *testing.T) {
	st := teststore.Open(t)
	defer st.Close()
	aliceID := uuid.NewString()
	bobID := uuid.NewString()
	guestID := uuid.NewString()
	caseyID := uuid.NewString()
	matchID := uuid.NewString()

	require.NoError(t, st.CreateRegisteredUser(aliceID, "Alice", "alice@example.com", "hash", "alice_cards"))
	require.NoError(t, st.CreateRegisteredUser(bobID, "Bob", "bob@example.com", "hash", "bob_cards"))
	require.NoError(t, st.CreateUser(guestID, "Guest", nil, nil))
	_, err := st.CreateProfile(guestID, "guest_cards")
	require.ErrorIs(t, err, store.ErrNotRegistered)

	err = st.CreateRegisteredUser(caseyID, "Casey", "casey@example.com", "hash", "ALICE_CARDS")
	require.Error(t, err, "handles are case-insensitive")

	profile, relationship, err := st.GetProfileByHandle("ALICE_CARDS", bobID)
	require.NoError(t, err)
	require.Equal(t, aliceID, profile.UserID)
	require.Equal(t, "none", relationship)

	require.NoError(t, st.CreateFriendRequest(aliceID, bobID))
	require.ErrorIs(t, st.CreateFriendRequest(bobID, aliceID), store.ErrFriendPending)
	bobRelationships, err := st.ListFriendships(bobID)
	require.NoError(t, err)
	require.Len(t, bobRelationships, 1)
	require.Equal(t, "incoming", bobRelationships[0].Direction)
	require.NoError(t, st.RespondToFriendRequest(bobID, bobRelationships[0].ID, true))

	_, relationship, err = st.GetProfileByHandle("alice_cards", bobID)
	require.NoError(t, err)
	require.Equal(t, "friends", relationship)
	require.NoError(t, st.RemoveFriendship(aliceID, bobRelationships[0].ID))
	_, relationship, err = st.GetProfileByHandle("alice_cards", bobID)
	require.NoError(t, err)
	require.Equal(t, "none", relationship)

	recorded, err := st.RecordCompletedMatch(matchID, "ROOM", []store.MatchParticipant{
		{UserID: aliceID, IsWinner: true},
		{UserID: bobID, IsWinner: false},
		{UserID: guestID, IsWinner: true},
	})
	require.NoError(t, err)
	require.True(t, recorded)
	recorded, err = st.RecordCompletedMatch(matchID, "ROOM", []store.MatchParticipant{{UserID: aliceID, IsWinner: true}})
	require.NoError(t, err)
	require.False(t, recorded, "the same match cannot increment statistics twice")

	alice, err := st.GetProfile(aliceID)
	require.NoError(t, err)
	require.Equal(t, 1, alice.GamesPlayed)
	require.Equal(t, 1, alice.GamesWon)
	bob, err := st.GetProfile(bobID)
	require.NoError(t, err)
	require.Equal(t, 1, bob.GamesPlayed)
	require.Equal(t, 0, bob.GamesWon)

	recent, err := st.ListRecentPlayers(aliceID, 20)
	require.NoError(t, err)
	require.Len(t, recent, 1)
	require.Equal(t, bobID, recent[0].UserID)

	_, err = st.GetProfile(guestID)
	require.True(t, errors.Is(err, store.ErrProfileNotFound))
}
