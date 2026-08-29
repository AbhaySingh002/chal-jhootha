import { create } from 'zustand';
import type { ConnectionStatus, GameState, ServerEvent, Card, PlayerRole } from 'shared';
import { PROTOCOL_VERSION } from 'shared';
import { sendEvent, connectSocket } from '../ws/socket';
import { ensureGuest } from '../lib/auth';

type PendingAction = {
  clientMsgId: string;
  type: 'start_game' | 'reset_to_lobby' | 'set_config' | 'play_cards' | 'challenge' | 'skip';
  startedAt: number;
};

interface GameStore {
  playerId: string | null;
  roomCode: string | null;
  rejoinToken: string | null;
  gameState: GameState | null;
  handsCount: Record<string, number>;
  myHand: Card[];
  lastChallengeResult: any | null;
  lastBurned: boolean;
  lastSeq: number;
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  lastError: string | null;
  pendingAction: PendingAction | null;
  youAreController: boolean;
  yourRole: PlayerRole | null;

  joinRoom: (roomCode: string, playerName: string) => Promise<void>;
  createRoom: (playerName: string, deckCount?: number, winnerCount?: number) => Promise<void>;
  startGame: () => void;
  resetToLobby: () => void;
  setConfig: (deckCount: number, winnerCount: number) => void;
  playCards: (cardIds: string[], claimedRank?: string) => void;
  challenge: () => void;
  skip: () => void;
  requestSync: () => void;
  sendVoice: (kind: string, payload?: unknown, targetUserId?: string) => void;
  sendReaction: (emoji: string) => void;
  resetSession: () => void;
  setConnectionStatus: (s: ConnectionStatus) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onMessage: (event: ServerEvent) => void;
}

const emptyState = (): Omit<GameState, 'roomCode' | 'phase' | 'players' | 'hostId'> => ({
  stackCount: 0,
  claimedRank: null,
  currentTurnPlayerId: null,
  roundOpenerId: null,
  lastAction: null,
  winners: [],
  deckCount: 1,
  winnerCount: 1,
  winnerCountLocked: false,
});

export const useGameStore = create<GameStore>((set, get) => ({
  playerId: sessionStorage.getItem('playerId'),
  roomCode: sessionStorage.getItem('roomCode'),
  rejoinToken: sessionStorage.getItem('rejoinToken'),
  gameState: null,
  handsCount: {},
  myHand: [],
  lastChallengeResult: null,
  lastBurned: false,
  lastSeq: 0,
  isConnected: false,
  connectionStatus: 'OFFLINE',
  lastError: null,
  pendingAction: null,
  youAreController: true,
  yourRole: null,

  joinRoom: async (roomCode, playerName) => {
    await ensureGuest(playerName);
    const existingToken = sessionStorage.getItem('rejoinToken');
    const existingRoom = sessionStorage.getItem('roomCode');
    const isRejoiningSameRoom = existingRoom === roomCode && !!existingToken;
    if (isRejoiningSameRoom) {
      set({ roomCode, lastError: null });
    } else {
      sessionStorage.removeItem('rejoinToken');
      sessionStorage.removeItem('roomCode');
      sessionStorage.removeItem('playerId');
      set({ roomCode, lastError: null, gameState: null, playerId: null, rejoinToken: null });
    }
    await connectSocket();
    sendEvent({
      type: 'join_room',
      roomCode,
      playerName,
      rejoinToken: isRejoiningSameRoom ? existingToken ?? undefined : undefined,
      clientMsgId: crypto.randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  createRoom: async (playerName, deckCount = 1, winnerCount = 1) => {
    await ensureGuest(playerName);
    sessionStorage.removeItem('playerId');
    sessionStorage.removeItem('roomCode');
    sessionStorage.removeItem('rejoinToken');
    set({ lastError: null, roomCode: null, gameState: null, playerId: null, rejoinToken: null, lastSeq: 0 });
    await connectSocket();
    sendEvent({
      type: 'create_room',
      playerName,
      deckCount,
      winnerCount,
      clientMsgId: crypto.randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  startGame: () => {
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'start_game', startedAt: Date.now() }, lastError: null });
    sendEvent({ type: 'start_game', clientMsgId, protocolVersion: PROTOCOL_VERSION });
  },

  resetToLobby: () => {
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'reset_to_lobby', startedAt: Date.now() }, lastError: null });
    sendEvent({ type: 'reset_to_lobby', clientMsgId, protocolVersion: PROTOCOL_VERSION });
  },

  setConfig: (deckCount, winnerCount) => {
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'set_config', startedAt: Date.now() }, lastError: null });
    sendEvent({
      type: 'set_config',
      deckCount,
      winnerCount,
      clientMsgId,
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  playCards: (cardIds, claimedRank) => {
    const { lastSeq, connectionStatus, youAreController, yourRole, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || yourRole === 'winner_spectator' || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'play_cards', startedAt: Date.now() }, lastError: null });
    sendEvent({
      type: 'play_cards',
      cardIds,
      claimedRank: claimedRank as any,
      expectedSeq: lastSeq,
      clientMsgId,
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  challenge: () => {
    const { lastSeq, connectionStatus, youAreController, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'challenge', startedAt: Date.now() }, lastError: null });
    sendEvent({
      type: 'challenge',
      expectedSeq: lastSeq,
      clientMsgId,
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  skip: () => {
    const { lastSeq, connectionStatus, youAreController, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'skip', startedAt: Date.now() }, lastError: null });
    sendEvent({
      type: 'skip',
      expectedSeq: lastSeq,
      clientMsgId,
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  requestSync: () => {
    set({ connectionStatus: 'SYNCING' });
    sendEvent({ type: 'sync_state', clientMsgId: crypto.randomUUID(), protocolVersion: PROTOCOL_VERSION });
  },

  sendVoice: (kind, payload, targetUserId) => {
    sendEvent({
      type: 'voice_signal',
      kind,
      payload,
      targetUserId,
      clientMsgId: crypto.randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  sendReaction: (emoji) => {
    sendEvent({
      type: 'reaction',
      emoji,
      clientMsgId: crypto.randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  resetSession: () => {
    sessionStorage.removeItem('playerId');
    sessionStorage.removeItem('roomCode');
    sessionStorage.removeItem('rejoinToken');
    set({
      playerId: null,
      roomCode: null,
      rejoinToken: null,
      gameState: null,
      handsCount: {},
      myHand: [],
      lastChallengeResult: null,
      lastBurned: false,
      lastSeq: 0,
      lastError: null,
      pendingAction: null,
      youAreController: true,
      yourRole: null,
    });
  },

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  onConnected: () => set({ isConnected: true, connectionStatus: 'CONNECTED' }),
  onDisconnected: () => set({ isConnected: false, connectionStatus: 'RECONNECTING' }),

  onMessage: (event: ServerEvent) => {
    const state = get();

    if ('seq' in event && typeof event.seq === 'number' && state.lastSeq > 0 && event.seq > state.lastSeq + 1) {
      get().requestSync();
    }

    switch (event.type) {
      case 'error':
        set({
          lastError: event.message,
          pendingAction: event.clientMsgId === state.pendingAction?.clientMsgId ? null : state.pendingAction,
          connectionStatus: state.isConnected ? 'CONNECTED' : state.connectionStatus,
        });
        break;
      case 'ack':
        if (event.rejoinToken && event.playerId && event.roomCode) {
          sessionStorage.setItem('playerId', event.playerId);
          sessionStorage.setItem('rejoinToken', event.rejoinToken);
          sessionStorage.setItem('roomCode', event.roomCode);
          set({
            playerId: event.playerId,
            rejoinToken: event.rejoinToken,
            roomCode: event.roomCode,
          });
        }
        if (event.appliedSeq) set({ lastSeq: event.appliedSeq });
        break;
      case 'action_accepted':
        set({
          lastSeq: event.appliedSeq || state.lastSeq,
          pendingAction: event.clientMsgId === state.pendingAction?.clientMsgId ? null : state.pendingAction,
        });
        break;
      case 'action_rejected':
        set({
          lastError: event.message,
          pendingAction: event.clientMsgId === state.pendingAction?.clientMsgId ? null : state.pendingAction,
          connectionStatus: state.isConnected ? 'CONNECTED' : state.connectionStatus,
        });
        break;
      case 'room_state': {
        const activeRoomCode = state.roomCode || sessionStorage.getItem('roomCode') || '';
        set({
          roomCode: activeRoomCode,
          lastSeq: event.seq,
          connectionStatus: 'CONNECTED',
          gameState: {
            ...emptyState(),
            ...state.gameState,
            roomCode: activeRoomCode,
            phase: event.phase,
            players: event.players,
            hostId: event.hostId,
            deckCount: event.deckCount ?? state.gameState?.deckCount ?? 1,
            winnerCount: event.winnerCount ?? state.gameState?.winnerCount ?? 1,
            winnerCountLocked: event.winnerCountLocked ?? state.gameState?.winnerCountLocked ?? false,
          },
        });
        break;
      }
      case 'game_state':
        set((current) => {
          const safe = current.gameState || {
            roomCode: current.roomCode || '',
            phase: 'lobby' as const,
            players: [],
            hostId: '',
            ...emptyState(),
          };
          return {
            lastSeq: event.seq,
            connectionStatus: 'CONNECTED' as ConnectionStatus,
            youAreController: event.youAreController ?? current.youAreController,
            yourRole: event.yourRole ?? current.yourRole,
            gameState: {
              ...safe,
              phase: event.phase || safe.phase,
              players: event.players || safe.players,
              hostId: event.hostId || safe.hostId,
              stackCount: event.stackCount,
              claimedRank: event.claimedRank as any,
              currentTurnPlayerId: event.currentTurnPlayerId,
              lastAction: event.lastAction,
              roundOpenerId: event.roundOpenerId,
              winners: event.winners ?? safe.winners,
              deckCount: event.deckCount ?? safe.deckCount,
              winnerCount: event.winnerCount ?? safe.winnerCount,
              winnerCountLocked: event.winnerCountLocked ?? safe.winnerCountLocked,
              pendingFinishId: event.pendingFinishId,
            },
            handsCount: event.hands || {},
            myHand: event.yourHand || [],
          };
        });
        break;
      case 'challenge_result':
        set({ lastSeq: event.seq, lastChallengeResult: event });
        setTimeout(() => set({ lastChallengeResult: null }), 3000);
        break;
      case 'stack_burned':
        set({ lastSeq: event.seq, lastBurned: true });
        setTimeout(() => set({ lastBurned: false }), 2000);
        break;
      case 'player_won':
        set({
          lastSeq: event.seq,
          gameState: state.gameState
            ? {
                ...state.gameState,
                winners: event.winners ?? state.gameState.winners,
                phase: event.gameOver ? 'finished' : state.gameState.phase,
              }
            : state.gameState,
        });
        break;
      case 'player_disconnected':
        set({
          lastSeq: event.seq,
          gameState: state.gameState ? {
            ...state.gameState,
            players: state.gameState.players.map((player) => player.id === event.playerId ? { ...player, isDisconnected: true } : player),
          } : null,
        });
        break;
      case 'player_reconnected':
        set({
          lastSeq: event.seq,
          gameState: state.gameState ? {
            ...state.gameState,
            players: state.gameState.players.map((player) => player.id === event.playerId ? { ...player, isDisconnected: false, isAbandoned: false } : player),
          } : null,
        });
        break;
      case 'player_abandoned':
        set({
          lastSeq: event.seq,
          gameState: state.gameState ? {
            ...state.gameState,
            players: state.gameState.players.map((player) => player.id === event.playerId ? { ...player, isAbandoned: true, role: 'abandoned' } : player),
          } : null,
        });
        break;
      case 'device_superseded':
        set({ youAreController: false });
        break;
      case 'voice_signal':
        window.dispatchEvent(new CustomEvent('cj-voice', { detail: event }));
        break;
      case 'reaction':
        window.dispatchEvent(new CustomEvent('cj-reaction', {
          detail: { id: event.clientMsgId, playerName: event.playerName, emoji: event.emoji },
        }));
        break;
    }
  },
}));
