import { expect, test } from "bun:test";
import { getNextPlayerId, isBluff } from "./rules";
import type { Card, Player } from "./types";

test("isBluff returns correctly", () => {
  const cards: Card[] = [{ id: 'As#0', suit: 's', rank: 'A' }, { id: 'Ah#0', suit: 'h', rank: 'A' }];
  expect(isBluff(cards, 'A')).toBe(false);
  
  const bluffCards: Card[] = [{ id: 'As#0', suit: 's', rank: 'A' }, { id: 'Kh#0', suit: 'h', rank: 'K' }];
  expect(isBluff(bluffCards, 'A')).toBe(true);

  const mixedBluff: Card[] = [
    { id: '2c#0', suit: 'c', rank: '2' },
    { id: '2d#1', suit: 'd', rank: '2' },
    { id: '3s#0', suit: 's', rank: '3' },
  ];
  expect(isBluff(mixedBluff, '2')).toBe(true);
});

test("getNextPlayerId handles rotation, winners, abandoned, and pending finish", () => {
  const players: Player[] = [
    { id: '1', name: 'A', handCount: 5, isDisconnected: false, isWinner: false },
    { id: '2', name: 'B', handCount: 0, isDisconnected: false, isWinner: true },
    { id: '3', name: 'C', handCount: 5, isDisconnected: false, isWinner: false },
    { id: '4', name: 'D', handCount: 5, isDisconnected: true, isWinner: false, isAbandoned: true },
    { id: '5', name: 'E', handCount: 0, isDisconnected: false, isWinner: false },
  ];
  
  // Skips 2 (winner) and goes to 3
  expect(getNextPlayerId('1', players)).toBe('3');
  // From 3, skips 4 (abandoned) and 5 (pending finish) and wraps to 1
  expect(getNextPlayerId('3', players, '5')).toBe('1');
});

