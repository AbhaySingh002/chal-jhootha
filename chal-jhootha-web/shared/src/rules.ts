import type { Card, ClaimGroup, Rank, Suit } from './types';

export const OPENING_RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const MAX_OPENING_CARD_COUNT = OPENING_RANKS.length * 4;

const RANK_ORDER: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'A': 14,
};

const SUIT_ORDER: Record<Suit, number> = {
  's': 1,
  'h': 2,
  'd': 3,
  'c': 4,
};

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rankDiff = (RANK_ORDER[a.rank] ?? 0) - (RANK_ORDER[b.rank] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    const suitDiff = (SUIT_ORDER[a.suit] ?? 0) - (SUIT_ORDER[b.suit] ?? 0);
    if (suitDiff !== 0) return suitDiff;
    return a.id.localeCompare(b.id);
  });
}

export function getOpeningGroupCounts(cardCount: number): number[] | null {
  if (!Number.isInteger(cardCount) || cardCount < 1 || cardCount > MAX_OPENING_CARD_COUNT) return null;

  const groupCounts: number[] = [];
  let remaining = cardCount;
  while (remaining > 4) {
    groupCounts.push(4);
    remaining -= 4;
  }
  groupCounts.push(remaining);
  return groupCounts;
}

export function isValidOpeningClaims(claims: ClaimGroup[], cardCount: number): boolean {
  const groupCounts = getOpeningGroupCounts(cardCount);
  if (!groupCounts || claims.length !== groupCounts.length) return false;

  const ranks = new Set<Rank>();
  return claims.every((claim, index) => {
    if (!OPENING_RANKS.includes(claim.rank) || ranks.has(claim.rank) || claim.count !== groupCounts[index]) return false;
    ranks.add(claim.rank);
    return true;
  });
}

// Declarations intentionally take only a card count and announced ranks. The
// actual face-down cards never participate, so an opening bluff stays legal.
export function buildOpeningClaims(cardCount: number, ranks: Array<Rank | null>): ClaimGroup[] | null {
  const groupCounts = getOpeningGroupCounts(cardCount);
  if (!groupCounts || ranks.length !== groupCounts.length || ranks.some((rank) => rank === null)) return null;

  const claims = groupCounts.map((count, index) => ({ rank: ranks[index]!, count }));
  return isValidOpeningClaims(claims, cardCount) ? claims : null;
}
