import type { Card, Rank } from './types';

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
