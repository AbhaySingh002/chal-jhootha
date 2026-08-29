package rules

import (
	"chal-jhootha-server/internal/ws"
)

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

// SkipBurns is true when the player skipping is the round opener
// (the turn has already circled back to them).
func SkipBurns(skipperID string, roundOpenerID *string) bool {
	return roundOpenerID != nil && *roundOpenerID == skipperID
}
