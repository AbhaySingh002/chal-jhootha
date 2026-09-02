package ws

import "time"

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
)

type Player struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	UserID            *string    `json:"userId,omitempty"`
	GuestName         *string    `json:"guestName,omitempty"`
	AvatarID          string     `json:"avatarId,omitempty"`
	HandCount         int        `json:"handCount"`
	IsDisconnected    bool       `json:"isDisconnected"`
	IsWinner          bool       `json:"isWinner"`
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

// ClaimGroup describes one visible rank/count declaration. It deliberately
// contains no card IDs: cards remain face down until a challenge resolves.
type ClaimGroup struct {
	Rank  Rank `json:"rank"`
	Count int  `json:"count"`
}

// TopPlay is the latest actual card play. Unlike LastAction it survives skip
// events, because a skip never closes the window to challenge a bluff.
type TopPlay struct {
	PlayerID  string       `json:"playerId"`
	CardCount int          `json:"cardCount"`
	Claims    []ClaimGroup `json:"claims"`
}

// LastMatchSummary stays visible in the lobby after automatic match return.
type LastMatchSummary struct {
	WinnerIDs []string `json:"winnerIds"`
}

type GameState struct {
	RoomCode            string            `json:"roomCode"`
	Phase               GamePhase         `json:"phase"`
	Players             []Player          `json:"players"`
	HostID              string            `json:"hostId"`
	StackCount          int               `json:"stackCount"`
	ClaimedRank         *Rank             `json:"claimedRank"`
	CurrentTurnPlayerID *string           `json:"currentTurnPlayerId"`
	RoundOpenerID       *string           `json:"roundOpenerId"`
	TurnDeadlineUnixMs  *int64            `json:"turnDeadlineUnixMs,omitempty"`
	TurnDurationMs      int               `json:"turnDurationMs,omitempty"`
	LastAction          *LastAction       `json:"lastAction"`
	TopPlay             *TopPlay          `json:"topPlay,omitempty"`
	Winners             []string          `json:"winners,omitempty"`
	DeckCount           int               `json:"deckCount"`
	WinnerCount         int               `json:"winnerCount"`
	WinnerCountLocked   bool              `json:"winnerCountLocked"`
	PendingFinishID     *string           `json:"pendingFinishId,omitempty"`
	LastMatch           *LastMatchSummary `json:"lastMatch,omitempty"`
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
	PlayerName  string  `json:"playerName"`
	RejoinToken *string `json:"rejoinToken,omitempty"`
}

type CreateRoomEvent struct {
	BaseClientEvent
	PlayerName  string `json:"playerName"`
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
	CardIDs []string     `json:"cardIds" validate:"required,min=1"`
	Claims  []ClaimGroup `json:"claims,omitempty"`
	// ClaimedRank is retained for v1 clients opening a plain round. New
	// clients send Claims, including a single group for a plain opening.
	ClaimedRank *Rank `json:"claimedRank"`
	ExpectedSeq int   `json:"expectedSeq" validate:"required"`
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

type ReactionEvent struct {
	BaseClientEvent
	Emoji string `json:"emoji" validate:"required"`
}

type ResetToLobbyEvent struct {
	BaseClientEvent
}

// ReturnToLobbyEvent acknowledges the completed match for one player. The
// room stays finished until the host starts the next match.
type ReturnToLobbyEvent struct {
	BaseClientEvent
}

// LeaveRoomEvent is an explicit lobby departure. It is deliberately separate
// from a socket disconnect, which remains reconnectable.
type LeaveRoomEvent struct {
	BaseClientEvent
}

// DestroyRoomEvent permanently closes a lobby. Only its current host may send
// it; rooms with no seated players are also destroyed automatically.
type DestroyRoomEvent struct {
	BaseClientEvent
}

// Server Events

type RoomStateEvent struct {
	Type              string            `json:"type"`
	Seq               int               `json:"seq"`
	Players           []Player          `json:"players"`
	HostID            string            `json:"hostId"`
	Phase             GamePhase         `json:"phase"`
	DeckCount         int               `json:"deckCount"`
	WinnerCount       int               `json:"winnerCount"`
	WinnerCountLocked bool              `json:"winnerCountLocked"`
	LastMatch         *LastMatchSummary `json:"lastMatch,omitempty"`
}

type GameStateEvent struct {
	Type                  string            `json:"type"`
	Seq                   int               `json:"seq"`
	Phase                 GamePhase         `json:"phase"`
	Players               []Player          `json:"players,omitempty"`
	HostID                string            `json:"hostId,omitempty"`
	Hands                 map[string]int    `json:"hands"`
	YourHand              []Card            `json:"yourHand,omitempty"`
	StackCount            int               `json:"stackCount"`
	ClaimedRank           *Rank             `json:"claimedRank"`
	CurrentTurnPlayerID   *string           `json:"currentTurnPlayerId"`
	RoundOpenerID         *string           `json:"roundOpenerId"`
	TurnDeadlineUnixMs    *int64            `json:"turnDeadlineUnixMs,omitempty"`
	TurnDurationMs        int               `json:"turnDurationMs,omitempty"`
	LastAction            *LastAction       `json:"lastAction"`
	TopPlay               *TopPlay          `json:"topPlay,omitempty"`
	Winners               []string          `json:"winners,omitempty"`
	DeckCount             int               `json:"deckCount,omitempty"`
	WinnerCount           int               `json:"winnerCount,omitempty"`
	WinnerCountLocked     bool              `json:"winnerCountLocked"`
	PendingFinishID       *string           `json:"pendingFinishId,omitempty"`
	ResultsLobbyPlayerIDs []string          `json:"resultsLobbyPlayerIds,omitempty"`
	YouAreController      bool              `json:"youAreController"`
	YourRole              PlayerRole        `json:"yourRole,omitempty"`
	LastMatch             *LastMatchSummary `json:"lastMatch,omitempty"`
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

// ActionAcceptedEvent confirms that the room actor applied a gameplay command.
// Join acknowledgements remain `ack` for wire compatibility.
type ActionAcceptedEvent struct {
	Type        string `json:"type"`
	ClientMsgID string `json:"clientMsgId"`
	AppliedSeq  int    `json:"appliedSeq"`
}

type ActionRejectedEvent struct {
	Type        string `json:"type"`
	ClientMsgID string `json:"clientMsgId"`
	Code        string `json:"code"`
	Message     string `json:"message"`
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

type RoomLeftEvent struct {
	Type     string `json:"type"`
	Seq      int    `json:"seq"`
	RoomCode string `json:"roomCode"`
}

type RoomDestroyedEvent struct {
	Type     string `json:"type"`
	Seq      int    `json:"seq"`
	RoomCode string `json:"roomCode"`
}

type PlayerReconnectedEvent struct {
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

type ReactionBroadcast struct {
	Type        string `json:"type"`
	ClientMsgID string `json:"clientMsgId"`
	PlayerID    string `json:"playerId"`
	PlayerName  string `json:"playerName"`
	Emoji       string `json:"emoji"`
}

type RoomInviteServerEvent struct {
	Type        string    `json:"type"` // "room_invite"
	Token       string    `json:"token"`
	RoomCode    string    `json:"roomCode"`
	HostID      string    `json:"hostId"`
	HostName    string    `json:"hostName"`
	RecipientID string    `json:"recipientId"`
	ExpiresAt   time.Time `json:"expiresAt"`
}
