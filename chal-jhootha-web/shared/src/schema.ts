import { z } from 'zod';

export const PROTOCOL_VERSION = '1.0.0';

export const RankSchema = z.enum(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);

const BaseClientEvent = z.object({
  clientMsgId: z.string(),
  protocolVersion: z.string().optional(), // Optional for backward-compat during rollout, but validated on server
  roomCode: z.string().optional(),
});

// Client -> Server
export const JoinRoomSchema = BaseClientEvent.extend({
  type: z.literal('join_room'),
  roomCode: z.string(),
  playerName: z.string(),
  rejoinToken: z.string().optional(),
});

export const CreateRoomSchema = BaseClientEvent.extend({
  type: z.literal('create_room'),
  playerName: z.string(),
  deckCount: z.number().optional(),
  winnerCount: z.number().optional(),
});

export const SetConfigSchema = BaseClientEvent.extend({
  type: z.literal('set_config'),
  deckCount: z.number(),
  winnerCount: z.number(),
});

export const StartGameSchema = BaseClientEvent.extend({
  type: z.literal('start_game'),
});

export const PlayCardsSchema = BaseClientEvent.extend({
  type: z.literal('play_cards'),
  cardIds: z.array(z.string()).min(1),
  claimedRank: RankSchema.optional(), // Required if opener
  expectedSeq: z.number(), // Concurrency guard
});

export const ChallengeSchema = BaseClientEvent.extend({
  type: z.literal('challenge'),
  expectedSeq: z.number(),
});

export const SkipSchema = BaseClientEvent.extend({
  type: z.literal('skip'),
  expectedSeq: z.number(),
});

export const HeartbeatSchema = BaseClientEvent.extend({
  type: z.literal('heartbeat'),
});

export const SyncStateSchema = BaseClientEvent.extend({
  type: z.literal('sync_state'),
});

export const ResetToLobbySchema = BaseClientEvent.extend({
  type: z.literal('reset_to_lobby'),
});

export const VoiceSignalSchema = BaseClientEvent.extend({
  type: z.literal('voice_signal'),
  targetUserId: z.string().optional(),
  kind: z.string(),
  payload: z.any().optional(),
});

export const ClientEventSchema = z.discriminatedUnion('type', [
  JoinRoomSchema,
  CreateRoomSchema,
  SetConfigSchema,
  StartGameSchema,
  PlayCardsSchema,
  ChallengeSchema,
  SkipSchema,
  HeartbeatSchema,
  SyncStateSchema,
  ResetToLobbySchema,
  VoiceSignalSchema,
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type JoinRoomEvent = z.infer<typeof JoinRoomSchema>;
export type CreateRoomEvent = z.infer<typeof CreateRoomSchema>;
export type StartGameEvent = z.infer<typeof StartGameSchema>;
export type PlayCardsEvent = z.infer<typeof PlayCardsSchema>;
export type ChallengeEvent = z.infer<typeof ChallengeSchema>;
export type SkipEvent = z.infer<typeof SkipSchema>;
export type HeartbeatEvent = z.infer<typeof HeartbeatSchema>;
export type SetConfigEvent = z.infer<typeof SetConfigSchema>;
export type SyncStateEvent = z.infer<typeof SyncStateSchema>;
export type ResetToLobbyEvent = z.infer<typeof ResetToLobbySchema>;
