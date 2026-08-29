package ws

type Suit string

const (
	Clubs    Suit = "c"
	Diamonds Suit = "d"
	Hearts   Suit = "h"
	Spades   Suit = "s"
)

type Rank string

type Card struct {
	ID   string `json:"id"`
	Suit Suit   `json:"suit"`
	Rank Rank   `json:"rank"`
}

type PlayerRole string

const (
	RoleActive          PlayerRole = "active"
	RoleWinnerSpectator PlayerRole = "winner_spectator"
	RoleSpectator       PlayerRole = "spectator"
	RoleAbandoned       PlayerRole = "abandoned"
)

type Player struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	UserID            *string    `json:"userId,omitempty"`
	GuestName         *string    `json:"guestName,omitempty"`
	HandCount         int        `json:"handCount"`
	IsDisconnected    bool       `json:"isDisconnected"`
	IsWinner          bool       `json:"isWinner"`
	IsAbandoned       bool       `json:"isAbandoned"`
	Role              PlayerRole `json:"role,omitempty"`
	BluffsAttempted   int        `json:"bluffsAttempted,omitempty"`
	BluffsCaught      int        `json:"bluffsCaught,omitempty"`
	ChallengesMade    int        `json:"challengesMade,omitempty"`
	ChallengesCorrect int        `json:"challengesCorrect,omitempty"`
}

type GamePhase string

const (
	PhaseLobby    GamePhase = "lobby"
	PhasePlaying  GamePhase = "playing"
	PhaseFinished GamePhase = "finished"
)

type LastActionType string

const (
	ActionAdd       LastActionType = "add"
	ActionChallenge LastActionType = "challenge"
	ActionSkip      LastActionType = "skip"
	ActionWon       LastActionType = "won"
)

type LastAction struct {
	PlayerID string         `json:"playerId"`
	Type     LastActionType `json:"type"`
	Details  any            `json:"details,omitempty"`
}

type GameState struct {
	RoomCode            string      `json:"roomCode"`
	Phase               GamePhase   `json:"phase"`
	Players             []Player    `json:"players"`
	HostID              string      `json:"hostId"`
	StackCount          int         `json:"stackCount"`
	ClaimedRank         *Rank       `json:"claimedRank"`
	CurrentTurnPlayerID *string     `json:"currentTurnPlayerId"`
	RoundOpenerID       *string     `json:"roundOpenerId"`
	LastAction          *LastAction `json:"lastAction"`
	Winners             []string    `json:"winners,omitempty"`
	DeckCount           int         `json:"deckCount"`
	WinnerCount         int         `json:"winnerCount"`
	WinnerCountLocked   bool        `json:"winnerCountLocked"`
	PendingFinishID     *string     `json:"pendingFinishId,omitempty"`
}

// Client Events

type BaseClientEvent struct {
	ClientMsgID     string `json:"clientMsgId" validate:"required"`
	ProtocolVersion string `json:"protocolVersion,omitempty"`
	RoomCode        string `json:"roomCode,omitempty"`
	Type            string `json:"type" validate:"required"`
}

type JoinRoomEvent struct {
	BaseClientEvent
	PlayerName  string  `json:"playerName" validate:"required"`
	RejoinToken *string `json:"rejoinToken,omitempty"`
}

type CreateRoomEvent struct {
	BaseClientEvent
	PlayerName  string `json:"playerName" validate:"required"`
	DeckCount   int    `json:"deckCount,omitempty"`
	WinnerCount int    `json:"winnerCount,omitempty"`
}

type SetConfigEvent struct {
	BaseClientEvent
	DeckCount   int `json:"deckCount"`
	WinnerCount int `json:"winnerCount"`
}

type StartGameEvent struct {
	BaseClientEvent
}

type PlayCardsEvent struct {
	BaseClientEvent
	CardIDs     []string `json:"cardIds" validate:"required,min=1"`
	ClaimedRank *Rank    `json:"claimedRank"`
	ExpectedSeq int      `json:"expectedSeq" validate:"required"`
}

type ChallengeEvent struct {
	BaseClientEvent
	ExpectedSeq int `json:"expectedSeq" validate:"required"`
}

type SkipEvent struct {
	BaseClientEvent
	ExpectedSeq int `json:"expectedSeq" validate:"required"`
}

type SyncStateEvent struct {
	BaseClientEvent
}

type VoiceSignalEvent struct {
	BaseClientEvent
	TargetUserID string `json:"targetUserId,omitempty"`
	Kind         string `json:"kind" validate:"required"`
	Payload      any    `json:"payload,omitempty"`
}

type ResetToLobbyEvent struct {
	BaseClientEvent
}

// Server Events

type RoomStateEvent struct {
	Type              string    `json:"type"`
	Seq               int       `json:"seq"`
	Players           []Player  `json:"players"`
	HostID            string    `json:"hostId"`
	Phase             GamePhase `json:"phase"`
	DeckCount         int       `json:"deckCount"`
	WinnerCount       int       `json:"winnerCount"`
	WinnerCountLocked bool      `json:"winnerCountLocked"`
}

type GameStateEvent struct {
	Type                string         `json:"type"`
	Seq                 int            `json:"seq"`
	Phase               GamePhase      `json:"phase"`
	Players             []Player       `json:"players,omitempty"`
	HostID              string         `json:"hostId,omitempty"`
	Hands               map[string]int `json:"hands"`
	YourHand            []Card         `json:"yourHand,omitempty"`
	StackCount          int            `json:"stackCount"`
	ClaimedRank         *Rank          `json:"claimedRank"`
	CurrentTurnPlayerID *string        `json:"currentTurnPlayerId"`
	RoundOpenerID       *string        `json:"roundOpenerId"`
	LastAction          *LastAction    `json:"lastAction"`
	Winners             []string       `json:"winners,omitempty"`
	DeckCount           int            `json:"deckCount,omitempty"`
	WinnerCount         int            `json:"winnerCount,omitempty"`
	WinnerCountLocked   bool           `json:"winnerCountLocked"`
	PendingFinishID     *string        `json:"pendingFinishId,omitempty"`
	YouAreController    bool           `json:"youAreController"`
	YourRole            PlayerRole     `json:"yourRole,omitempty"`
}

type ChallengeResultEvent struct {
	Type          string `json:"type"`
	Seq           int    `json:"seq"`
	ChallengerID  string `json:"challengerId"`
	PlayedByID    string `json:"playedById"`
	WasBluff      bool   `json:"wasBluff"`
	RevealedCards []Card `json:"revealedCards"`
	PickedUpBy    string `json:"pickedUpBy"`
	NextStarterID string `json:"nextStarterId"`
}

type StackBurnedEvent struct {
	Type          string `json:"type"`
	Seq           int    `json:"seq"`
	NextStarterID string `json:"nextStarterId"`
}

type PlayerWonEvent struct {
	Type     string   `json:"type"`
	Seq      int      `json:"seq"`
	PlayerID string   `json:"playerId"`
	Winners  []string `json:"winners"`
	GameOver bool     `json:"gameOver"`
}

type AckEvent struct {
	Type        string  `json:"type"`
	ClientMsgID string  `json:"clientMsgId"`
	AppliedSeq  int     `json:"appliedSeq"`
	PlayerID    *string `json:"playerId,omitempty"`
	RoomCode    *string `json:"roomCode,omitempty"`
	RejoinToken *string `json:"rejoinToken,omitempty"`
}

type ErrorEvent struct {
	Type        string  `json:"type"`
	ClientMsgID *string `json:"clientMsgId,omitempty"`
	Code        string  `json:"code"`
	Message     string  `json:"message"`
}

type PlayerDisconnectedEvent struct {
	Type     string `json:"type"`
	Seq      int    `json:"seq"`
	PlayerID string `json:"playerId"`
}

type PlayerReconnectedEvent struct {
	Type     string `json:"type"`
	Seq      int    `json:"seq"`
	PlayerID string `json:"playerId"`
}

type PlayerAbandonedEvent struct {
	Type     string `json:"type"`
	Seq      int    `json:"seq"`
	PlayerID string `json:"playerId"`
}

type DeviceSupersededEvent struct {
	Type   string `json:"type"`
	Seq    int    `json:"seq"`
	Reason string `json:"reason"`
}

type VoiceSignalBroadcast struct {
	Type         string `json:"type"`
	FromUserID   string `json:"fromUserId"`
	TargetUserID string `json:"targetUserId,omitempty"`
	Kind         string `json:"kind"`
	Payload      any    `json:"payload,omitempty"`
}
