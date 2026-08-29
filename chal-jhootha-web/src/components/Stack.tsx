import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../state/gameStore';
import { Card } from './Card';

export const Stack: React.FC = () => {
  const { gameState } = useGameStore();
  
  if (!gameState || gameState.stackCount === 0) {
    return (
      <div className="w-32 h-48 border-4 border-dashed border-ink/20 rounded-2xl flex items-center justify-center">
        <span className="text-ink/30 font-bold uppercase tracking-widest text-sm">Empty Stack</span>
      </div>
    );
  }

  // Create a visually fanned stack
  const stackCards = Array.from({ length: Math.min(gameState.stackCount, 15) });

  return (
    <div className="relative w-32 h-48 flex items-center justify-center">
      <AnimatePresence>
        {stackCards.map((_, i) => (
          <motion.div
            key={i}
            className="absolute"
            initial={{ scale: 1.5, opacity: 0, y: -50 }}
            animate={{ 
              scale: 1, 
              opacity: 1, 
              y: 0,
              rotate: (i % 5) * 5 - 10,
              x: (i % 3) * 4 - 6
            }}
            transition={{ duration: 0.2, delay: i * 0.02 }}
          >
            <Card faceDown />
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="absolute -top-12 bg-white text-ink font-bold font-sans px-4 py-2 border-[3px] border-ink rounded-xl shadow-[4px_4px_0_#14140F] flex flex-col items-center leading-tight whitespace-nowrap z-10">
        <span className="text-xs uppercase tracking-wider text-neutral-500">Claimed Rank</span>
        <span className="text-xl font-display font-black text-evidence-red">{gameState.claimedRank}s</span>
        <span className="text-[10px] uppercase font-mono mt-1 bg-neutral-200 px-2 py-0.5 rounded-full">{gameState.stackCount} cards in stack</span>
      </div>
    </div>
  );
};
