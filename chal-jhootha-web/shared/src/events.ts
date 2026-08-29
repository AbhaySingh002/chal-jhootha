import type { Card, GameState, Player, PlayerRole } from './types';

export interface BaseServerEvent {
  seq: number;
}

export interface RoomStateEvent extends BaseServerEvent {
  type: 'room_state';
  players: Player[];
  hostId: string;
  phase: GameState['phase'];
  deckCount?: number;
  winnerCount?: number;
  winnerCountLocked?: boolean;
}

export interface GameStateEvent extends BaseServerEvent {
  type: 'game_state';
  phase?: GameState['phase'];
  players?: Player[];
  hostId?: string;
  hands: Record<string, number>;
  yourHand?: Card[];
  stackCount: number;
  claimedRank: string | null;
  currentTurnPlayerId: string | null;
  lastAction: GameState['lastAction'];
  roundOpenerId: string | null;
  winners?: string[];
  deckCount?: number;
  winnerCount?: number;
  winnerCountLocked?: boolean;
  pendingFinishId?: string | null;
  youAreController?: boolean;
  yourRole?: PlayerRole;
}

export interface ChallengeResultEvent extends BaseServerEvent {
  type: 'challenge_result';
  challengerId: string;
  playedById: string;
  wasBluff: boolean;
  revealedCards: Card[];
  pickedUpBy: string;
  nextStarterId: string;
}

export interface StackBurnedEvent extends BaseServerEvent {
  type: 'stack_burned';
  nextStarterId: string;
}

export interface PlayerWonEvent extends BaseServerEvent {
  type: 'player_won';
  playerId: string;
  winners?: string[];
  gameOver?: boolean;
}

export interface AckEvent {
  type: 'ack';
  clientMsgId: string;
  appliedSeq: number;
  playerId?: string;
  roomCode?: string;
  rejoinToken?: string;
}

export interface ErrorEvent {
  type: 'error';
  clientMsgId?: string;
  code: string;
  message: string;
}

export interface PlayerDisconnectedEvent extends BaseServerEvent {
  type: 'player_disconnected';
  playerId: string;
}

export interface PlayerReconnectedEvent extends BaseServerEvent {
  type: 'player_reconnected';
  playerId: string;
}

export interface PlayerAbandonedEvent extends BaseServerEvent {
  type: 'player_abandoned';
  playerId: string;
}

export interface DeviceSupersededEvent extends BaseServerEvent {
  type: 'device_superseded';
  reason: string;
}

export interface VoiceSignalEvent extends BaseServerEvent {
  type: 'voice_signal';
  fromUserId: string;
  targetUserId?: string;
  kind: string;
  payload?: unknown;
}

export type ServerEvent =
  | RoomStateEvent
  | GameStateEvent
  | ChallengeResultEvent
  | StackBurnedEvent
  | PlayerWonEvent
  | AckEvent
  | ErrorEvent
  | PlayerDisconnectedEvent
  | PlayerReconnectedEvent
  | PlayerAbandonedEvent
  | DeviceSupersededEvent
  | VoiceSignalEvent;
