import type { ClaimGroup, Rank } from './types';

export const OPENING_RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const MAX_OPENING_CARD_COUNT = OPENING_RANKS.length * 4;

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
