import { beforeAll, expect, test } from 'bun:test';
import type { GameState } from 'shared';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();

beforeAll(() => {
  Object.assign(globalThis, {
    sessionStorage: storage,
    window: { addEventListener: () => undefined, dispatchEvent: () => true },
  });
});

test('a reconnect keeps an abandoned player in read-only status', async () => {
  const { useGameStore } = await import('./gameStore');
  const state: GameState = {
    roomCode: 'TEST',
    phase: 'playing',
    hostId: 'host',
    stackCount: 0,
    claimedRank: null,
    currentTurnPlayerId: 'host',
    roundOpenerId: 'host',
    lastAction: null,
    players: [
      { id: 'host', name: 'Host', handCount: 5, isDisconnected: false, isWinner: false },
      { id: 'retired', name: 'Retired', handCount: 0, isDisconnected: true, isWinner: false, isAbandoned: true, role: 'abandoned' },
    ],
  };

  useGameStore.setState({ gameState: state, lastSeq: 1 });
  useGameStore.getState().onMessage({ type: 'player_reconnected', seq: 2, playerId: 'retired' });

  const player = useGameStore.getState().gameState?.players.find((item) => item.id === 'retired');
  expect(player?.isDisconnected).toBe(false);
  expect(player?.isAbandoned).toBe(true);
  expect(player?.role).toBe('abandoned');
});

test('a completed-match snapshot keeps each player\'s lobby return acknowledgement', async () => {
  const { useGameStore } = await import('./gameStore');
  useGameStore.setState({
    gameState: {
      roomCode: 'TEST',
      phase: 'finished',
      hostId: 'host',
      stackCount: 0,
      claimedRank: null,
      currentTurnPlayerId: null,
      roundOpenerId: null,
      lastAction: null,
      players: [
        { id: 'host', name: 'Host', handCount: 0, isDisconnected: false, isWinner: true },
        { id: 'guest', name: 'Guest', handCount: 2, isDisconnected: false, isWinner: false },
      ],
      winners: ['host'],
      resultsLobbyPlayerIds: [],
    },
    lastSeq: 10,
  });

  useGameStore.getState().onMessage({
    type: 'game_state',
    seq: 11,
    phase: 'finished',
    players: [
      { id: 'host', name: 'Host', handCount: 0, isDisconnected: false, isWinner: true },
      { id: 'guest', name: 'Guest', handCount: 2, isDisconnected: false, isWinner: false },
    ],
    hostId: 'host',
    hands: { host: 0, guest: 2 },
    stackCount: 0,
    claimedRank: null,
    currentTurnPlayerId: null,
    roundOpenerId: null,
    lastAction: null,
    winners: ['host'],
    resultsLobbyPlayerIds: ['host'],
  });

  expect(useGameStore.getState().gameState?.phase).toBe('finished');
  expect(useGameStore.getState().gameState?.resultsLobbyPlayerIds).toEqual(['host']);
});

test('play, challenge, and skip require an active controller', async () => {
  const { useGameStore } = await import('./gameStore');
  useGameStore.setState({
    connectionStatus: 'CONNECTED',
    youAreController: true,
    yourRole: 'winner_spectator',
    pendingAction: null,
    lastSeq: 1,
  });
  useGameStore.getState().playCards(['x']);
  useGameStore.getState().challenge();
  useGameStore.getState().skip();
  expect(useGameStore.getState().pendingAction).toBeNull();
});
