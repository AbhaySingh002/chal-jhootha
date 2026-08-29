export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export type PlayerRole = 'active' | 'winner_spectator' | 'spectator' | 'abandoned';
export type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE' | 'SYNCING';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export interface Player {
  id: string;
  name: string;
  userId?: string | null;
  guestName?: string | null;
  handCount: number;
  isDisconnected: boolean;
  isWinner: boolean;
  isAbandoned?: boolean;
  role?: PlayerRole;
  bluffsAttempted?: number;
  bluffsCaught?: number;
  challengesMade?: number;
  challengesCorrect?: number;
}

export type GamePhase = 'lobby' | 'playing' | 'finished';

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Player[];
  hostId: string;
  stackCount: number;
  claimedRank: Rank | null;
  currentTurnPlayerId: string | null;
  roundOpenerId: string | null;
  lastAction: {
    playerId: string;
    type: 'add' | 'challenge' | 'skip' | 'won';
    details?: any;
  } | null;
  winners?: string[];
  deckCount?: number;
  winnerCount?: number;
  winnerCountLocked?: boolean;
  pendingFinishId?: string | null;
}
