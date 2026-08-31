import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../state/gameStore';
import { Card } from './Card';

const UNDER_CARD_OFFSETS = [
  { rotate: -5, x: -4, y: 2.5 },
  { rotate: 4.5, x: 4, y: 2 },
  { rotate: -2.5, x: -2.5, y: 1.2 },
  { rotate: 2, x: 2, y: 0.5 },
];

interface MinimalRankCardProps {
  rank: string | null;
}

const MinimalRankCard: React.FC<MinimalRankCardProps> = ({ rank }) => {
  const displayRank = rank || '?';

  return (
    <div
      className="game-stack-card relative flex items-center justify-center overflow-hidden rounded-xl sm:rounded-2xl border-2 border-ink p-1 sm:p-1.5 select-none"
      style={{
        background: 'var(--stack-card-bg)',
        borderColor: 'var(--stack-card-border)',
      }}
    >
      {/* Inner docket card body with Devanagari engraved watermark, corner pips & geometric centerpiece */}
      <div
        className="card-watermark-bg relative flex h-full w-full flex-col justify-between overflow-hidden rounded-lg sm:rounded-xl p-1.5 sm:p-2"
        style={{
          border: '1px solid var(--card-back-border)',
        }}
      >
        {/* Top-Left Corner Index */}
        <div className="flex items-center justify-start leading-none">
          <div className="flex flex-col items-center">
            <span
              className="font-display text-xs sm:text-sm font-black leading-none"
              style={{ color: 'var(--color-evidence-red)' }}
            >
              {displayRank}
            </span>
            <span
              className="mt-0.5 text-[8px] sm:text-[9px] leading-none"
              style={{ color: 'var(--color-evidence-red)' }}
            >
              ♦
            </span>
          </div>
        </div>

        {/* Center Hero Rank */}
        <div className="my-auto flex flex-col items-center justify-center text-center">
          <span
            className="font-display text-5xl sm:text-6xl md:text-7xl font-black leading-none tracking-tight select-none"
            style={{ color: 'var(--stack-card-rank)' }}
          >
            {displayRank}
          </span>
        </div>

        {/* Bottom-Right Corner Index (Inverted) */}
        <div className="flex items-center justify-end leading-none">
          <div className="flex flex-col items-center rotate-180">
            <span
              className="font-display text-xs sm:text-sm font-black leading-none"
              style={{ color: 'var(--color-evidence-red)' }}
            >
              {displayRank}
            </span>
            <span
              className="mt-0.5 text-[8px] sm:text-[9px] leading-none"
              style={{ color: 'var(--color-evidence-red)' }}
            >
              ♦
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Stack: React.FC = () => {
  const { gameState } = useGameStore();
  const topActor = gameState?.topPlay
    ? gameState.players.find((player) => player.id === gameState.topPlay?.playerId)?.name
    : null;

  // Authoritative active claimed rank
  const activeRank = gameState?.claimedRank || gameState?.topPlay?.claims?.[0]?.rank || null;

  if (!gameState || gameState.stackCount === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center">
        <div
          data-card-stack-anchor
          className="game-stack-card flex flex-col items-center justify-center rounded-xl sm:rounded-2xl border-2 border-dashed border-ink/30 bg-surface/25 p-2.5 sm:p-3 text-center transition-all"
        >
          <span className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-ink-muted">
            Empty Pile
          </span>
        </div>

        <div className="z-10 mt-2.5 flex min-h-8 flex-col items-center rounded-md border-2 border-ink bg-surface px-3.5 py-1.5 text-center font-mono shadow-[2px_2px_0_var(--color-ink)]">
          <span className="font-display text-xs sm:text-sm uppercase tracking-wide text-ink">
            0 in pile
          </span>
          {topActor ? (
            <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-muted">
              Last play · {topActor}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // Number of fanned under-cards to render under the top card (max 4 layers)
  const underCardCount = Math.min(gameState.stackCount - 1, 4);
  const underCards = Array.from({ length: Math.max(0, underCardCount) });

  return (
    <div className="relative flex flex-col items-center justify-center">
      <div
        data-card-stack-anchor
        className="game-stack-card relative flex items-center justify-center"
      >
        <AnimatePresence>
          {/* Under-cards layered cleanly with subtle natural offsets */}
          {underCards.map((_, i) => {
            const offset = UNDER_CARD_OFFSETS[i % UNDER_CARD_OFFSETS.length];
            return (
              <motion.div
                key={`undercard-${i}`}
                className="absolute inset-0 pointer-events-none"
                initial={{ scale: 1.06, opacity: 0, y: -10 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  y: offset.y,
                  x: offset.x,
                  rotate: offset.rotate,
                }}
                transition={{ duration: 0.16, delay: i * 0.015 }}
                style={{ zIndex: i + 1 }}
              >
                <Card faceDown noShadow className="game-stack-card !shadow-none" />
              </motion.div>
            );
          })}

          {/* Top Card showcasing authoritative declared rank */}
          <motion.div
            key={`topcard-${activeRank}-${gameState.stackCount}`}
            className="absolute inset-0"
            initial={{ scale: 1.05, opacity: 0.8, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            style={{ zIndex: 10 }}
          >
            <MinimalRankCard rank={activeRank} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Status details pill with refined typography and red numerals */}
      <div className="z-10 mt-3 flex min-h-8 flex-col items-center rounded-md border-2 border-ink bg-surface px-3.5 py-1.5 text-center font-mono shadow-[2px_2px_0_var(--color-ink)] max-w-[22rem]">
        {/* Primary Line */}
        <div className="flex items-center gap-1.5 font-display text-xs sm:text-sm uppercase tracking-wide text-ink">
          {activeRank ? (
            <span className="inline-flex items-baseline">
              <span className="text-evidence-red font-black">{activeRank}</span>
              <span className="text-ink font-bold">'s</span>
            </span>
          ) : (
            <span>Evidence</span>
          )}
          <span className="text-ink-muted font-normal">·</span>
          <span className="font-mono text-xs sm:text-sm font-bold text-ink">
            {gameState.stackCount} in pile
          </span>
        </div>

        {/* Secondary Line (Last Play) */}
        {topActor && gameState.topPlay?.claims && gameState.topPlay.claims.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1 text-center font-mono text-[10px] font-normal uppercase tracking-[0.04em] text-ink-muted">
            <span className="font-semibold text-ink-muted">Last play</span>
            <span>·</span>
            <span className="font-bold text-ink">{topActor}</span>
            <span>·</span>
            <span className="inline-flex flex-wrap items-center gap-x-1">
              {gameState.topPlay.claims.map((claim, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="opacity-60">+</span>}
                  <span className="inline-flex items-baseline font-mono text-[10px]">
                    <span className="font-medium">{claim.count} × </span>
                    <span className="text-evidence-red font-bold ml-0.5">{claim.rank}</span>
                    <span className="text-ink-muted">'s</span>
                  </span>
                </React.Fragment>
              ))}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
};
