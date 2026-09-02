import { create } from 'zustand';
import type { ConnectionStatus, GameState, ServerEvent, Card, ClaimGroup, PlayerRole } from 'shared';
import { PROTOCOL_VERSION, sortCards } from 'shared';
import { sendEvent, connectSocket, disconnectSocket } from '../ws/socket';
import { clearGuest, ensureGuest } from '../lib/auth';

type PendingAction = {
  clientMsgId: string;
  type: 'start_game' | 'reset_to_lobby' | 'return_to_lobby' | 'set_config' | 'play_cards' | 'challenge' | 'skip' | 'leave_room' | 'destroy_room';
  startedAt: number;
};

interface GameStore {
  playerId: string | null;
  roomCode: string | null;
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
  returnToLobby: () => void;
  setConfig: (deckCount: number, winnerCount: number) => void;
  playCards: (cardIds: string[], claims?: ClaimGroup[]) => void;
  challenge: () => void;
  skip: () => void;
  leaveRoom: () => void;
  destroyRoom: () => void;
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
  turnDeadlineUnixMs: null,
  turnDurationMs: 45000,
  lastAction: null,
  winners: [],
  deckCount: 1,
  winnerCount: 1,
  winnerCountLocked: false,
  resultsLobbyPlayerIds: [],
});

export const useGameStore = create<GameStore>((set, get) => ({
  playerId: sessionStorage.getItem('playerId'),
  roomCode: sessionStorage.getItem('roomCode'),
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
    const existingRoom = sessionStorage.getItem('roomCode');
    const isRejoiningSameRoom = existingRoom === roomCode && !!sessionStorage.getItem('playerId');
    await ensureGuest(playerName, !isRejoiningSameRoom);
    if (isRejoiningSameRoom) {
      set({ roomCode, lastError: null });
    } else {
      sessionStorage.removeItem('roomCode');
      sessionStorage.removeItem('playerId');
      set({ roomCode, lastError: null, gameState: null, playerId: null });
    }
    await connectSocket();
    sendEvent({
      type: 'join_room',
      roomCode,
      playerName,
      clientMsgId: crypto.randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  createRoom: async (playerName, deckCount = 1, winnerCount = 1) => {
    await ensureGuest(playerName, true);
    sessionStorage.removeItem('playerId');
    sessionStorage.removeItem('roomCode');
    set({ lastError: null, roomCode: null, gameState: null, playerId: null, lastSeq: 0 });
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
    const { connectionStatus, youAreController, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'start_game', startedAt: Date.now() }, lastError: null });
    sendEvent({ type: 'start_game', clientMsgId, protocolVersion: PROTOCOL_VERSION });
  },

  resetToLobby: () => {
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'reset_to_lobby', startedAt: Date.now() }, lastError: null });
    sendEvent({ type: 'reset_to_lobby', clientMsgId, protocolVersion: PROTOCOL_VERSION });
  },

  returnToLobby: () => {
    const { connectionStatus, youAreController, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'return_to_lobby', startedAt: Date.now() }, lastError: null });
    sendEvent({ type: 'return_to_lobby', clientMsgId, protocolVersion: PROTOCOL_VERSION });
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

  playCards: (cardIds, claims) => {
    const { lastSeq, connectionStatus, youAreController, yourRole, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || yourRole !== 'active' || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'play_cards', startedAt: Date.now() }, lastError: null });
    sendEvent({
      type: 'play_cards',
      cardIds,
      claims,
      expectedSeq: lastSeq,
      clientMsgId,
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  challenge: () => {
    const { gameState, playerId, lastSeq, connectionStatus, youAreController, yourRole, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || yourRole !== 'active' || pendingAction) return;
    if (!gameState?.topPlay || gameState.topPlay.playerId === playerId) return;
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
    const { lastSeq, connectionStatus, youAreController, yourRole, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || yourRole !== 'active' || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'skip', startedAt: Date.now() }, lastError: null });
    sendEvent({
      type: 'skip',
      expectedSeq: lastSeq,
      clientMsgId,
      protocolVersion: PROTOCOL_VERSION,
    });
  },

  leaveRoom: () => {
    const { connectionStatus, youAreController, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || !youAreController || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'leave_room', startedAt: Date.now() }, lastError: null });
    sendEvent({ type: 'leave_room', clientMsgId, protocolVersion: PROTOCOL_VERSION });
  },

  destroyRoom: () => {
    const { connectionStatus, pendingAction } = get();
    if (connectionStatus !== 'CONNECTED' || pendingAction) return;
    const clientMsgId = crypto.randomUUID();
    set({ pendingAction: { clientMsgId, type: 'destroy_room', startedAt: Date.now() }, lastError: null });
    sendEvent({ type: 'destroy_room', clientMsgId, protocolVersion: PROTOCOL_VERSION });
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
    set({
      playerId: null,
      roomCode: null,
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
        if (event.playerId && event.roomCode) {
          sessionStorage.setItem('playerId', event.playerId);
          sessionStorage.setItem('roomCode', event.roomCode);
          set({
            playerId: event.playerId,
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
            lastMatch: event.lastMatch ?? state.gameState?.lastMatch ?? null,
            resultsLobbyPlayerIds: state.gameState?.resultsLobbyPlayerIds ?? [],
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
              topPlay: event.topPlay ?? safe.topPlay ?? null,
              roundOpenerId: event.roundOpenerId,
              turnDeadlineUnixMs: event.turnDeadlineUnixMs !== undefined ? event.turnDeadlineUnixMs : safe.turnDeadlineUnixMs,
              turnDurationMs: event.turnDurationMs ?? safe.turnDurationMs ?? 45000,
              winners: event.winners ?? safe.winners,
              deckCount: event.deckCount ?? safe.deckCount,
              winnerCount: event.winnerCount ?? safe.winnerCount,
              winnerCountLocked: event.winnerCountLocked ?? safe.winnerCountLocked,
              pendingFinishId: event.pendingFinishId,
              resultsLobbyPlayerIds: event.resultsLobbyPlayerIds ?? safe.resultsLobbyPlayerIds ?? [],
              lastMatch: event.lastMatch ?? safe.lastMatch ?? null,
            },
            handsCount: event.hands || {},
            myHand: sortCards(event.yourHand || []),
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
            players: state.gameState.players.map((player) => player.id === event.playerId ? { ...player, isDisconnected: false } : player),
          } : null,
        });
        break;
      case 'room_left':
      case 'room_destroyed':
        disconnectSocket();
        get().resetSession();
        void clearGuest();
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
