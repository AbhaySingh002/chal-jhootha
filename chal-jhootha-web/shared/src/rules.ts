import type { Card, ClaimGroup, Rank } from './types';

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

export function getNextPlayerId(
  currentId: string,
  players: { id: string; isWinner: boolean; isAbandoned?: boolean; handCount?: number }[],
  pendingFinishId?: string | null,
): string {
  const currentIndex = players.findIndex(p => p.id === currentId);
  const start = currentIndex === -1 ? 0 : currentIndex;
  for (let i = 1; i <= players.length; i++) {
    const nextPlayer = players[(start + i) % players.length];
    if (nextPlayer.isWinner || nextPlayer.isAbandoned) continue;
    if (pendingFinishId && nextPlayer.id === pendingFinishId && (nextPlayer.handCount ?? 0) === 0) continue;
    return nextPlayer.id;
  }
  return currentId;
}

export function isBluff(playedCards: Card[], claimedRank: Rank): boolean {
  return playedCards.some(card => card.rank !== claimedRank);
}
