import { expect, test } from "bun:test";
import { buildOpeningClaims, getNextPlayerId, getOpeningGroupCounts, isBluff, isValidOpeningClaims, MAX_OPENING_CARD_COUNT } from "./rules";
import type { Card, ClaimGroup, Player, Rank } from "./types";

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

test("opening group counts are derived from selected cards", () => {
	for (let cardCount = 1; cardCount <= MAX_OPENING_CARD_COUNT; cardCount += 1) {
		const groups = getOpeningGroupCounts(cardCount)!;
		expect(groups.reduce((total, count) => total + count, 0)).toBe(cardCount);
		expect(groups.at(-1)).toBe(cardCount % 4 || 4);
		expect(groups.slice(0, -1).every((count) => count === 4)).toBe(true);
	}
	expect(getOpeningGroupCounts(5)).toEqual([4, 1]);
	expect(getOpeningGroupCounts(11)).toEqual([4, 4, 3]);
	expect(getOpeningGroupCounts(MAX_OPENING_CARD_COUNT)).toEqual(Array(13).fill(4));
  expect(getOpeningGroupCounts(0)).toBeNull();
  expect(getOpeningGroupCounts(MAX_OPENING_CARD_COUNT + 1)).toBeNull();
});

test("opening claims enforce group shape, ranks, and totals", () => {
  const valid: ClaimGroup[] = [{ rank: 'K', count: 4 }, { rank: '3', count: 1 }];
  expect(isValidOpeningClaims(valid, 5)).toBe(true);
  expect(isValidOpeningClaims([{ rank: 'K', count: 3 }, { rank: '3', count: 2 }], 5)).toBe(false);
  expect(isValidOpeningClaims([{ rank: 'K', count: 4 }, { rank: '3', count: 5 }], 9)).toBe(false);
  expect(isValidOpeningClaims([{ rank: 'K', count: 5 }], 5)).toBe(false);
  expect(isValidOpeningClaims([{ rank: 'K', count: 4 }, { rank: 'K', count: 1 }], 5)).toBe(false);
  expect(isValidOpeningClaims([{ rank: 'Z' as Rank, count: 1 }], 1)).toBe(false);
});

test("opening claims can be a bluff because card ranks are not an input", () => {
  expect(buildOpeningClaims(5, ['K', '3'])).toEqual([
    { rank: 'K', count: 4 },
    { rank: '3', count: 1 },
  ]);
  expect(buildOpeningClaims(5, ['K', 'K'])).toBeNull();
  expect(buildOpeningClaims(5, ['K', null])).toBeNull();
});
