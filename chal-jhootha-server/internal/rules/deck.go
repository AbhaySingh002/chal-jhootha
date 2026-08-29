package rules

import (
	cryptorand "crypto/rand"
	"encoding/binary"
	"fmt"
	"math/rand"

	"chal-jhootha-server/internal/ws"
)

func GenerateDecks(deckCount int) []ws.Card {
	if deckCount < 1 {
		deckCount = 1
	}
	if deckCount > 3 {
		deckCount = 3
	}
	suits := []ws.Suit{ws.Clubs, ws.Diamonds, ws.Hearts, ws.Spades}
	ranks := []ws.Rank{"2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"}

	var deck []ws.Card
	for d := 0; d < deckCount; d++ {
		for _, suit := range suits {
			for _, rank := range ranks {
				deck = append(deck, ws.Card{
					ID:   fmt.Sprintf("%s%s#%d", rank, suit, d),
					Suit: suit,
					Rank: rank,
				})
			}
		}
	}
	return deck
}

func Shuffle(deck []ws.Card) []ws.Card {
	var seed int64
	_ = binary.Read(cryptorand.Reader, binary.LittleEndian, &seed)
	r := rand.New(rand.NewSource(seed))

	shuffled := make([]ws.Card, len(deck))
	copy(shuffled, deck)
	r.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})
	return shuffled
}

// PickRandomID selects a player id. Tests may replace this.
var PickRandomID = func(ids []string) string {
	if len(ids) == 0 {
		return ""
	}
	var n uint64
	_ = binary.Read(cryptorand.Reader, binary.LittleEndian, &n)
	return ids[n%uint64(len(ids))]
}

func IsAceOfSpades(c ws.Card) bool {
	return c.Rank == "A" && c.Suit == ws.Spades
}

// Deal hands round-robin until leftover < player count. Opener is the player
// who received the earliest Ace of Spades in deal order; random if none dealt.
func Deal(deck []ws.Card, playerIDs []string) (hands map[string][]ws.Card, leftover []ws.Card, openerID string) {
	hands = make(map[string][]ws.Card)
	for _, id := range playerIDs {
		hands[id] = []ws.Card{}
	}
	if len(playerIDs) == 0 {
		return hands, deck, ""
	}

	n := len(playerIDs)
	dealable := (len(deck) / n) * n
	openerID = ""
	for i := 0; i < dealable; i++ {
		card := deck[i]
		pid := playerIDs[i%n]
		hands[pid] = append(hands[pid], card)
		if openerID == "" && IsAceOfSpades(card) {
			openerID = pid
		}
	}
	leftover = append([]ws.Card{}, deck[dealable:]...)
	if openerID == "" {
		openerID = PickRandomID(playerIDs)
	}
	return hands, leftover, openerID
}
