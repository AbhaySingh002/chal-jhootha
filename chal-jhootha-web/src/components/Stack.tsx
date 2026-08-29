import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../state/gameStore';
import { Card } from './Card';

export const Stack: React.FC = () => {
  const { gameState } = useGameStore();
  const lastActor = gameState?.lastAction
    ? gameState.players.find((player) => player.id === gameState.lastAction?.playerId)?.name
    : null;
  const emptyClaimLabel = gameState?.claimedRank
    ? `${gameState.claimedRank}s · 0 in stack`
    : 'Fresh round · 0 in stack';

  if (!gameState || gameState.stackCount === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center">
        <div
          data-card-stack-anchor
          className="flex items-center justify-center rounded-xl border-2 border-dashed border-ink/30 bg-surface/30 shadow-[2px_2px_0_var(--color-ink)]"
          style={{ width: 'clamp(5.5rem, 16vw, 7.5rem)', height: 'clamp(7.5rem, 23vw, 10.5rem)' }}
        >
          <span className="px-2 text-center font-mono text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
            Empty stack
          </span>
        </div>
        <div className="mt-2.5 flex min-h-8 flex-col items-center rounded-md border-2 border-ink bg-surface px-3 py-1.5 text-center font-mono shadow-[2px_2px_0_var(--color-ink)]">
          <span className="font-display text-sm uppercase text-ink">{emptyClaimLabel}</span>
          {lastActor ? <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted">{lastActor}</span> : null}
        </div>
      </div>
    );
  }

  // Create a visually fanned stack
  const stackCards = Array.from({ length: Math.min(gameState.stackCount, 7) });

  return (
    <div className="relative flex flex-col items-center justify-center">
      <div
        data-card-stack-anchor
        className="relative flex items-center justify-center"
        style={{ width: 'clamp(5.5rem, 16vw, 7.5rem)', height: 'clamp(7.5rem, 23vw, 10.5rem)' }}
      >
        <AnimatePresence>
          {stackCards.map((_, i) => (
            <motion.div
              key={i}
              className="absolute"
              initial={{ scale: 1.15, opacity: 0, y: -20 }}
              animate={{
                scale: 1,
                opacity: 1,
                y: 0,
                rotate: (i % 5) * 4 - 8,
                x: (i % 3) * 3 - 4
              }}
              transition={{ duration: 0.16, delay: i * 0.015 }}
            >
              <Card faceDown />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="z-10 mt-2.5 flex min-h-8 flex-col items-center rounded-md border-2 border-ink bg-surface px-3 py-1.5 text-center font-mono shadow-[2px_2px_0_var(--color-ink)]">
        <span className="font-display text-sm uppercase text-ink">
          <span className="text-evidence-red">{gameState.claimedRank}s</span> · {gameState.stackCount} in stack
        </span>
        {lastActor ? <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted">{lastActor}</span> : null}
      </div>
    </div>
  );
};
