import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Play, X } from 'lucide-react';
import { buildOpeningClaims, getOpeningGroupCounts, OPENING_RANKS } from 'shared';
import type { ClaimGroup, Rank } from 'shared';

interface OpeningDeclarationProps {
  selectedCardCount: number;
  onConfirm: (claims: ClaimGroup[]) => void;
  onClose: () => void;
}

const rankName = (rank: Rank) => (rank === 'J' ? 'Jack' : rank === 'Q' ? 'Queen' : rank === 'K' ? 'King' : rank === 'A' ? 'Ace' : rank);

export const OpeningDeclaration: React.FC<OpeningDeclarationProps> = ({ selectedCardCount, onConfirm, onClose }) => {
  const reduceMotion = useReducedMotion();
  const groupCounts = getOpeningGroupCounts(selectedCardCount);
  const [ranks, setRanks] = useState<Array<Rank | null>>(() => Array<Rank | null>(groupCounts?.length ?? 0).fill(null));
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);

  if (!groupCounts) return null;

  const activeRank = ranks[activeGroupIndex] ?? null;
  const claims = buildOpeningClaims(selectedCardCount, ranks);
  const groupCountLabel = groupCounts.join(' + ');

  const chooseRank = (rank: Rank) => {
    setRanks((current) => current.map((currentRank, index) => index === activeGroupIndex ? rank : currentRank));
  };

  return (
    <motion.section
      key="opening-declaration"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 6 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 28 }}
      className="game-opening-declaration"
      aria-label="Declare opening play"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {selectedCardCount} cards <span aria-hidden="true">· {groupCountLabel}</span>
        </p>
        <button type="button" onClick={onClose} className="icon-btn h-9 w-9 shrink-0" aria-label="Cancel declaration" title="Cancel declaration">
          <X size={17} strokeWidth={2.5} />
        </button>
      </div>

      {groupCounts.length > 1 ? (
        <div className="game-opening-groups no-scrollbar" role="tablist" aria-label="Claim groups">
          {groupCounts.map((count, index) => {
            const isFinal = index === groupCounts.length - 1;
            const isActive = index === activeGroupIndex;
            const rank = ranks[index];
            return (
              <button
                key={`${count}-${index}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`${isFinal ? 'Active rank group, ' : ''}${count} cards, ${rank ? rankName(rank) : 'choose rank'}`}
                onClick={() => setActiveGroupIndex(index)}
                className={`game-opening-group ${isActive ? 'is-selected' : ''} ${isFinal ? 'is-final' : ''}`}
              >
                <span>{count}</span>
                <strong>{rank ?? '—'}</strong>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="min-w-0">
        <span className="sr-only" id="opening-rank-label">Choose the claimed rank for {groupCounts[activeGroupIndex]} cards</span>
        <div className="game-rank-rail no-scrollbar" role="listbox" aria-labelledby="opening-rank-label">
          {OPENING_RANKS.map((rank) => {
            const usedByAnotherGroup = ranks.some((chosenRank, index) => index !== activeGroupIndex && chosenRank === rank);
            const selected = activeRank === rank;
            return (
              <button
                key={rank}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={usedByAnotherGroup}
                onClick={() => chooseRank(rank)}
                title={usedByAnotherGroup ? `${rankName(rank)} is already claimed` : `Claim ${rankName(rank)}`}
                className={`game-rank-option ${selected ? 'is-selected' : ''}`}
              >
                {rank}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        disabled={!claims}
        onClick={() => claims && onConfirm(claims)}
        className="brutal-btn game-opening-confirm bg-caution-yellow text-ink"
        aria-label={`Play ${selectedCardCount} declared cards`}
        title="Play declared cards"
      >
        <Play size={18} strokeWidth={2.5} />
        <span className="hidden sm:inline">Play {selectedCardCount}</span>
      </button>
    </motion.section>
  );
};
