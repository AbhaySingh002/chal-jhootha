import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../state/gameStore';
import { Card } from './Card';

export const Stack: React.FC = () => {
  const { gameState } = useGameStore();
  
  if (!gameState || gameState.stackCount === 0) {
    return (
      <div className="flex items-center justify-center border-3 border-dashed border-ink-muted/60" style={{ width: 'clamp(5rem, 15vw, 7rem)', height: 'clamp(7rem, 22vw, 10rem)' }}>
        <span className="px-2 text-center font-mono text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">Empty stack</span>
      </div>
    );
  }

  // Create a visually fanned stack
  const stackCards = Array.from({ length: Math.min(gameState.stackCount, 7) });

  return (
    <div className="relative flex items-center justify-center" style={{ width: 'clamp(5rem, 15vw, 7rem)', height: 'clamp(7rem, 22vw, 10rem)' }}>
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
      <div className="absolute -top-11 z-10 flex flex-col items-center whitespace-nowrap border-2 border-ink bg-surface px-3 py-2 font-sans font-bold leading-tight shadow-[3px_3px_0_var(--color-ink)]">
        <span className="text-xs uppercase tracking-wider text-ink-muted">Claimed rank</span>
        <span className="font-display text-xl text-evidence-red">{gameState.claimedRank}s</span>
        <span className="mt-1 border border-ink bg-paper px-1.5 py-0.5 font-mono text-[10px] uppercase">{gameState.stackCount} in stack</span>
      </div>
    </div>
  );
};
