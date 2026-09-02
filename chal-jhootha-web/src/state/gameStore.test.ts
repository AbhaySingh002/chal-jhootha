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

test('a reconnect marks the player connected', async () => {
  const { useGameStore } = await import('./gameStore');
  const state: GameState = {
    roomCode: 'TEST',
    phase: 'playing',
    hostId: 'host',
    stackCount: 0,
    claimedRank: null,
    currentTurnPlayerId: 'host',
    roundOpenerId: 'host',
    turnDeadlineUnixMs: Date.now() + 45000,
    turnDurationMs: 45000,
    lastAction: null,
    players: [
      { id: 'host', name: 'Host', handCount: 5, isDisconnected: false, isWinner: false },
      { id: 'p2', name: 'Player2', handCount: 5, isDisconnected: true, isWinner: false },
    ],
  };

  useGameStore.setState({ gameState: state, lastSeq: 1 });
  useGameStore.getState().onMessage({ type: 'player_reconnected', seq: 2, playerId: 'p2' });

  const player = useGameStore.getState().gameState?.players.find((item) => item.id === 'p2');
  expect(player?.isDisconnected).toBe(false);
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

test('challenge is disallowed when top play belongs to the local player', async () => {
  const { useGameStore } = await import('./gameStore');
  useGameStore.setState({
    playerId: 'p1',
    connectionStatus: 'CONNECTED',
    youAreController: true,
    yourRole: 'active',
    pendingAction: null,
    lastSeq: 2,
    gameState: {
      phase: 'playing',
      currentTurnPlayerId: 'p1',
      topPlay: { playerId: 'p1', cardCount: 1, claims: [{ rank: 'A', count: 1 }] },
    } as any,
  });

  useGameStore.getState().challenge();
  expect(useGameStore.getState().pendingAction).toBeNull();

  // If top play is by another player, challenge proceeds
  useGameStore.setState({
    gameState: {
      phase: 'playing',
      currentTurnPlayerId: 'p1',
      topPlay: { playerId: 'p2', cardCount: 1, claims: [{ rank: 'A', count: 1 }] },
    } as any,
  });

  useGameStore.getState().challenge();
  expect(useGameStore.getState().pendingAction?.type).toBe('challenge');
});

test('game_state event automatically sorts yourHand into myHand', async () => {
  const { useGameStore } = await import('./gameStore');
  useGameStore.getState().onMessage({
    type: 'game_state',
    seq: 10,
    phase: 'playing',
    hostId: 'p1',
    stackCount: 0,
    claimedRank: null,
    currentTurnPlayerId: 'p1',
    roundOpenerId: 'p1',
    lastAction: null,
    players: [],
    hands: {},
    yourHand: [
      { id: '1', rank: 'K', suit: 's' },
      { id: '2', rank: '3', suit: 'h' },
      { id: '3', rank: 'A', suit: 'd' },
      { id: '4', rank: '3', suit: 's' },
      { id: '5', rank: '2', suit: 'c' },
    ],
  });

  const myHand = useGameStore.getState().myHand;
  expect(myHand.map((c) => `${c.rank}${c.suit}`)).toEqual([
    '2c', '3s', '3h', 'Ks', 'Ad',
  ]);
});


