import React from 'react';
import { motion } from 'framer-motion';
import type { Card as CardType } from 'shared';
import clsx from 'clsx';

interface CardProps {
  card?: CardType;
  faceDown?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const suitSymbols: Record<string, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

const suitColors: Record<string, string> = {
  s: 'text-neutral-900',
  h: 'text-red-600',
  d: 'text-red-600',
  c: 'text-neutral-900',
};

export const Card: React.FC<CardProps> = ({
  card,
  faceDown = false,
  selected = false,
  onClick,
  className,
  style,
}) => {
  return (
    <motion.div
      onClick={onClick}
      className={clsx(
        'relative w-16 h-24 sm:w-24 sm:h-36 cursor-pointer flex-shrink-0 origin-bottom',
        'border-[3px] border-ink bg-white select-none rounded-xl sm:rounded-2xl overflow-hidden',
        selected ? 'shadow-[0px_-10px_20px_rgba(0,0,0,0.15)] ring-4 ring-caution-yellow ring-offset-2 ring-offset-paper' : 'shadow-[4px_4px_0_var(--color-ink)]',
        className
      )}
      style={style}
      layout
      initial={{ opacity: 0, y: 100 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      animate={{ y: selected ? -20 : 0, scale: selected ? 1.05 : 1, opacity: 1 }}
      whileHover={{ y: selected ? -20 : -10, scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      exit={{ opacity: 0, y: -100, scale: 0.8 }}
    >
      {faceDown || !card ? (
        // Card Back (Confidential)
        <div className="w-full h-full bg-ink flex items-center justify-center p-2">
          <div className="border-2 border-paper/30 rounded-lg sm:rounded-xl w-full h-full flex flex-col items-center justify-center bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,0.05)_4px,rgba(255,255,255,0.05)_8px)]">
            <span className="text-white font-mono text-[8px] sm:text-xs font-bold tracking-widest text-center rotate-45 opacity-80">EVIDENCE</span>
          </div>
        </div>
      ) : (
        // Card Front
        <div className={clsx('w-full h-full flex flex-col justify-between p-1.5 sm:p-2', suitColors[card.suit])}>
          <div className="flex flex-col items-center leading-none self-start">
            <span className="text-xl sm:text-3xl font-black font-sans tracking-tighter">{card.rank}</span>
            <span className="text-sm sm:text-2xl mt-0.5">{suitSymbols[card.suit]}</span>
          </div>
          <div className="flex flex-col items-center rotate-180 leading-none self-start">
            <span className="text-xl sm:text-3xl font-black font-sans tracking-tighter">{card.rank}</span>
            <span className="text-sm sm:text-2xl mt-0.5">{suitSymbols[card.suit]}</span>
          </div>
        </div>
      )}
    </motion.div>
  );
};
