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

const suitIsRed: Record<string, boolean> = {
  s: false,
  h: true,
  d: true,
  c: false,
};

export const Card: React.FC<CardProps> = ({
  card,
  faceDown = false,
  selected = false,
  onClick,
  className,
  style,
}) => {
  const interactive = Boolean(onClick);
  return (
    <motion.div
      onClick={onClick}
      onKeyDown={(event) => {
        if (interactive && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick?.();
        }
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={card ? `${card.rank} of ${suitSymbols[card.suit]}` : faceDown ? 'Face-down card' : undefined}
      className={clsx(
        'relative h-24 w-16 flex-shrink-0 origin-bottom select-none overflow-hidden border-[3px] border-ink bg-surface sm:h-32 sm:w-20',
        interactive ? 'cursor-pointer' : 'cursor-default',
        selected ? 'shadow-[0px_-8px_0_var(--color-caution-yellow)] ring-2 ring-caution-yellow ring-offset-2 ring-offset-paper' : 'shadow-[3px_3px_0_var(--color-ink)]',
        className
      )}
      style={style}
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      animate={{ y: selected ? -20 : 0, scale: selected ? 1.05 : 1, opacity: 1 }}
      whileHover={interactive ? { y: selected ? -20 : -6, scale: 1.03 } : undefined}
      whileTap={{ scale: 0.95 }}
      exit={{ opacity: 0, y: -100, scale: 0.8 }}
    >
      {faceDown || !card ? (
        // Card Back (Confidential)
        <div className="w-full h-full bg-ink flex items-center justify-center p-2">
          <div
            className="w-full h-full flex flex-col items-center justify-center"
            style={{
              border: '2px solid var(--card-back-border)',
              background: `repeating-linear-gradient(45deg, transparent, transparent 4px, var(--card-back-stripe) 4px, var(--card-back-stripe) 8px)`,
            }}
          >
            <span className="text-white font-mono text-[8px] sm:text-xs font-bold tracking-widest text-center rotate-45 opacity-80">EVIDENCE</span>
          </div>
        </div>
      ) : (
        // Card Front — uses CSS variables for dark-mode-aware suit colors
        <div
          className="w-full h-full flex flex-col justify-between p-1.5 sm:p-2"
          style={{ color: suitIsRed[card.suit] ? 'var(--suit-red)' : 'var(--suit-black)' }}
        >
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
