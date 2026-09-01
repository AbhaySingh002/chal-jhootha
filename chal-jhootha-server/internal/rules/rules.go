package rules

import (
	"chal-jhootha-server/internal/ws"
)

const MaxOpeningCards = 52

func IsValidRank(rank ws.Rank) bool {
	switch rank {
	case "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A":
		return true
	default:
		return false
	}
}

// ValidOpeningClaims checks only the public declaration, never the ranks of
// the face-down cards. That keeps legal bluffs possible while enforcing the
// opening combo shape: four-card groups followed by one final one-to-four-card
// group.
func ValidOpeningClaims(claims []ws.ClaimGroup, cardCount int) bool {
	if len(claims) == 0 || len(claims) > 13 || cardCount < 1 || cardCount > MaxOpeningCards {
		return false
	}

	seenRanks := make(map[ws.Rank]struct{}, len(claims))
	total := 0
	for index, claim := range claims {
		if !IsValidRank(claim.Rank) {
			return false
		}
		if _, duplicate := seenRanks[claim.Rank]; duplicate {
			return false
		}
		seenRanks[claim.Rank] = struct{}{}

		isFinalGroup := index == len(claims)-1
		if isFinalGroup {
			if claim.Count < 1 || claim.Count > 4 {
				return false
			}
		} else if claim.Count != 4 {
			return false
		}
		total += claim.Count
	}

	return total == cardCount
}

func IsFinished(p ws.Player) bool {
	return p.IsWinner
}

func IsPendingEmpty(p ws.Player, pendingFinishID *string) bool {
	if pendingFinishID == nil || *pendingFinishID == "" {
		return false
	}
	return p.ID == *pendingFinishID && p.HandCount == 0 && !p.IsWinner
}

func IsInRotation(p ws.Player, pendingFinishID *string) bool {
	if p.IsWinner || p.IsAbandoned {
		return false
	}
	if IsPendingEmpty(p, pendingFinishID) {
		return false
	}
	return true
}

func GetNextPlayerID(currentID string, players []ws.Player, pendingFinishID *string) string {
	currentIndex := -1
	for i, p := range players {
		if p.ID == currentID {
			currentIndex = i
			break
		}
	}
	if currentIndex == -1 && len(players) > 0 {
		currentIndex = 0
	}
	for i := 1; i <= len(players); i++ {
		next := players[(currentIndex+i)%len(players)]
		if IsInRotation(next, pendingFinishID) {
			return next.ID
		}
	}
	return currentID
}

func ActiveCount(players []ws.Player) int {
	n := 0
	for _, p := range players {
		if !p.IsWinner && !p.IsAbandoned {
			n++
		}
	}
	return n
}

func ShouldEndGame(winnerCount int, winners []string, players []ws.Player) bool {
	if winnerCount < 1 {
		winnerCount = 1
	}
	if len(winners) >= winnerCount {
		return true
	}
	return ActiveCount(players) <= 1
}

func ClampLobbyConfig(deckCount, winnerCount, playerCount int) (int, int) {
	if deckCount < 1 {
		deckCount = 1
	}
	if deckCount > 3 {
		deckCount = 3
	}
	if winnerCount < 1 {
		winnerCount = 1
	}
	maxWinners := playerCount - 1
	if maxWinners < 1 {
		maxWinners = 1
	}
	if winnerCount > maxWinners {
		winnerCount = maxWinners
	}
	return deckCount, winnerCount
}

func IsBluff(playedCards []ws.Card, claimedRank ws.Rank) bool {
	for _, card := range playedCards {
		if card.Rank != claimedRank {
			return true
		}
	}
	return false
}

// IsClaimBluff checks the complete visible claim for a play. A combo is true
// only when its claimed rank/count multiset exactly matches the played cards.
func IsClaimBluff(playedCards []ws.Card, claims []ws.ClaimGroup) bool {
	if len(playedCards) == 0 || len(claims) == 0 {
		return true
	}
	claimed := make(map[ws.Rank]int, len(claims))
	claimTotal := 0
	for _, claim := range claims {
		if claim.Count < 1 || claim.Rank == "" {
			return true
		}
		claimed[claim.Rank] += claim.Count
		claimTotal += claim.Count
	}
	if claimTotal != len(playedCards) {
		return true
	}
	actual := make(map[ws.Rank]int, len(claimed))
	for _, card := range playedCards {
		actual[card.Rank]++
	}
	if len(actual) != len(claimed) {
		return true
	}
	for rank, count := range claimed {
		if actual[rank] != count {
			return true
		}
	}
	return false
}
