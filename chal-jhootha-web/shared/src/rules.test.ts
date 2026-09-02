import { expect, test } from "bun:test";
import { buildOpeningClaims, getOpeningGroupCounts, isValidOpeningClaims, MAX_OPENING_CARD_COUNT, sortCards } from "./rules";
import type { Card, ClaimGroup, Rank } from "./types";

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

test("sortCards arranges cards by rank ascending, suit, and id", () => {
  const input: Card[] = [
    { id: 'c1', rank: 'A', suit: 's' },
    { id: 'c2', rank: '2', suit: 'h' },
    { id: 'c3', rank: 'K', suit: 'd' },
    { id: 'c4', rank: '2', suit: 's' },
    { id: 'c5', rank: '10', suit: 'c' },
    { id: 'c6', rank: 'K', suit: 's' },
  ];

  const sorted = sortCards(input);
  expect(sorted.map((c) => `${c.rank}${c.suit}`)).toEqual([
    '2s', '2h', '10c', 'Ks', 'Kd', 'As',
  ]);
});

