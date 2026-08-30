package rules

import (
	"testing"

	"chal-jhootha-server/internal/ws"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetNextPlayerID(t *testing.T) {
	tests := []struct {
		name      string
		currentID string
		players   []ws.Player
		pending   *string
		expected  string
	}{
		{
			name:      "simple next player",
			currentID: "p1",
			players: []ws.Player{
				{ID: "p1"}, {ID: "p2"}, {ID: "p3"},
			},
			expected: "p2",
		},
		{
			name:      "wraparound",
			currentID: "p3",
			players: []ws.Player{
				{ID: "p1"}, {ID: "p2"}, {ID: "p3"},
			},
			expected: "p1",
		},
		{
			name:      "skips winners",
			currentID: "p1",
			players: []ws.Player{
				{ID: "p1"}, {ID: "p2", IsWinner: true}, {ID: "p3"},
			},
			expected: "p3",
		},
		{
			name:      "skips abandoned",
			currentID: "p1",
			players: []ws.Player{
				{ID: "p1"}, {ID: "p2", IsAbandoned: true}, {ID: "p3"},
			},
			expected: "p3",
		},
		{
			name:      "skips pending empty",
			currentID: "p1",
			players: []ws.Player{
				{ID: "p1"}, {ID: "p2", HandCount: 0}, {ID: "p3"},
			},
			pending:  strPtr("p2"),
			expected: "p3",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, GetNextPlayerID(tt.currentID, tt.players, tt.pending))
		})
	}
}

func TestIsBluff(t *testing.T) {
	assert.False(t, IsBluff([]ws.Card{{Rank: "A"}, {Rank: "A"}}, "A"))
	assert.True(t, IsBluff([]ws.Card{{Rank: "A"}, {Rank: "K"}}, "A"))
}

func TestIsClaimBluffForComboClaims(t *testing.T) {
	claims := []ws.ClaimGroup{{Rank: "A", Count: 2}, {Rank: "K", Count: 1}}
	assert.False(t, IsClaimBluff([]ws.Card{{Rank: "K"}, {Rank: "A"}, {Rank: "A"}}, claims))
	assert.True(t, IsClaimBluff([]ws.Card{{Rank: "K"}, {Rank: "A"}, {Rank: "Q"}}, claims), "one mismatch sinks the entire combo")
	assert.True(t, IsClaimBluff([]ws.Card{{Rank: "A"}, {Rank: "K"}}, claims), "visible count must match all claim groups")
}

func TestDealLeftoversAndUniqueIDs(t *testing.T) {
	deck := GenerateDecks(1)
	assert.Equal(t, 52, len(deck))
	ids := map[string]bool{}
	for _, c := range deck {
		assert.False(t, ids[c.ID], "duplicate id %s", c.ID)
		ids[c.ID] = true
	}

	hands, leftover, opener := Deal(deck, []string{"a", "b", "c"})
	assert.Equal(t, 1, len(leftover))
	assert.Equal(t, 17, len(hands["a"]))
	assert.Equal(t, 17, len(hands["b"]))
	assert.Equal(t, 17, len(hands["c"]))
	assert.NotEmpty(t, opener)
}

func TestDealMultiDeckUniqueIDs(t *testing.T) {
	deck := GenerateDecks(2)
	assert.Equal(t, 104, len(deck))
	ids := map[string]bool{}
	for _, c := range deck {
		require.False(t, ids[c.ID], c.ID)
		ids[c.ID] = true
	}
}

func TestEarliestAceOfSpadesOpener(t *testing.T) {
	// Sequential deal: a,b,a,b... first A♠ goes to whoever is next in that order.
	deck := []ws.Card{
		{ID: "2c#0", Rank: "2", Suit: ws.Clubs},
		{ID: "As#0", Rank: "A", Suit: ws.Spades},
		{ID: "As#1", Rank: "A", Suit: ws.Spades},
		{ID: "3c#0", Rank: "3", Suit: ws.Clubs},
	}
	_, _, opener := Deal(deck, []string{"a", "b"})
	assert.Equal(t, "b", opener) // index 1 is first A♠
}

func TestDealRandomFallbackWhenNoAce(t *testing.T) {
	old := PickRandomID
	t.Cleanup(func() { PickRandomID = old })
	PickRandomID = func(ids []string) string { return ids[0] }

	deck := []ws.Card{
		{ID: "2c#0", Rank: "2", Suit: ws.Clubs},
		{ID: "3c#0", Rank: "3", Suit: ws.Clubs},
	}
	_, leftover, opener := Deal(deck, []string{"a", "b"})
	assert.Equal(t, 0, len(leftover))
	assert.Equal(t, "a", opener)
}

func TestSkipBurns(t *testing.T) {
	opener := "p1"
	assert.True(t, SkipBurns("p1", &opener))
	assert.False(t, SkipBurns("p2", &opener))
}

func TestShouldEndGame(t *testing.T) {
	players := []ws.Player{
		{ID: "a", IsWinner: true},
		{ID: "b"},
		{ID: "c"},
	}
	assert.True(t, ShouldEndGame(1, []string{"a"}, players))
	assert.False(t, ShouldEndGame(2, []string{"a"}, players))

	players[1].IsWinner = true
	assert.True(t, ShouldEndGame(2, []string{"a", "b"}, players))

	// last active remaining
	players = []ws.Player{
		{ID: "a", IsWinner: true},
		{ID: "b"},
		{ID: "c", IsAbandoned: true},
	}
	assert.True(t, ShouldEndGame(4, []string{"a"}, players))
}

func TestClampLobbyConfig(t *testing.T) {
	d, w := ClampLobbyConfig(0, 0, 4)
	assert.Equal(t, 1, d)
	assert.Equal(t, 1, w)
	d, w = ClampLobbyConfig(9, 10, 4)
	assert.Equal(t, 3, d)
	assert.Equal(t, 3, w)
}

func strPtr(s string) *string { return &s }
