import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Card as CardType } from 'shared';
import clsx from 'clsx';

interface CardProps {
  card?: CardType;
  faceDown?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  rotation?: number;
  arcY?: number;
  zIndex?: number;
  concealed?: boolean;
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

const SELECTED_CARD_LIFT_PX = 32;
const SELECTED_CARD_HOVER_LIFT_PX = 3;

export const Card: React.FC<CardProps> = ({
  card,
  faceDown = false,
  selected = false,
  onClick,
  className,
  style,
  rotation = 0,
  arcY = 0,
  zIndex,
  concealed = false,
}) => {
  const interactive = Boolean(onClick);
  const reduceMotion = useReducedMotion();
  const selectedY = selected ? arcY - SELECTED_CARD_LIFT_PX : arcY;
  return (
    <motion.div
      onClick={onClick}
      onKeyDown={(event) => {
        if (interactive && !concealed && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick?.();
        }
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive && !concealed ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={card ? `${card.rank} of ${suitSymbols[card.suit]}` : faceDown ? 'Face-down card' : undefined}
      data-hand-card-id={card?.id}
      className={clsx(
        'relative h-28 w-18 sm:h-36 sm:w-24 flex-shrink-0 origin-bottom select-none overflow-hidden rounded-xl border-2 border-ink bg-surface shadow-[2px_2px_0_var(--color-ink)] transition-shadow sm:rounded-2xl sm:border-[2.5px]',
        interactive && !concealed ? 'cursor-pointer' : 'cursor-default',
        concealed && 'pointer-events-none',
        selected && 'shadow-[0px_-6px_0_var(--color-caution-yellow)] ring-2 ring-caution-yellow ring-offset-2 ring-offset-paper',
        className
      )}
      style={{
        ...style,
        zIndex: selected ? 50 : zIndex,
      }}
      layout="position"
      initial={reduceMotion ? false : { opacity: 0, y: 16, rotate: rotation }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 26 }}
      animate={{
        y: selectedY,
        rotate: rotation,
        scale: concealed ? 0.96 : selected ? 1.035 : 1,
        opacity: concealed ? 0 : 1,
      }}
      whileHover={
        interactive && !concealed
          ? {
              y: selected ? selectedY - SELECTED_CARD_HOVER_LIFT_PX : arcY - 10,
              rotate: rotation * 0.4,
              scale: 1.06,
              zIndex: 45,
            }
          : undefined
      }
      whileTap={{ scale: 0.96 }}
      exit={{ opacity: 0, y: -100, scale: 0.8 }}
    >
      {faceDown || !card ? (
        // Card Back (Confidential)
        <div className="w-full h-full bg-ink flex items-center justify-center p-2 rounded-xl sm:rounded-2xl">
          <div
            className="w-full h-full flex flex-col items-center justify-center rounded-lg sm:rounded-xl"
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
          className="w-full h-full flex flex-col justify-between p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl"
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
