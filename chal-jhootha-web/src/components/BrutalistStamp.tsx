import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BrutalistStampProps {
  text: string;
  color?: 'red' | 'green' | 'yellow' | 'black';
  show: boolean;
}

const colorMap = {
  red: 'text-evidence-red border-evidence-red',
  green: 'text-confirmed-green border-confirmed-green',
  yellow: 'text-caution-yellow border-caution-yellow',
  black: 'text-ink border-ink'
};

export const BrutalistStamp: React.FC<BrutalistStampProps> = ({ text, color = 'red', show }) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ scale: 3, opacity: 0, rotate: -20 }}
          animate={{ scale: 1, opacity: 1, rotate: -15 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="pointer-events-none fixed inset-0 flex items-center justify-center z-50"
        >
          <div className={`border-[6px] p-3 sm:border-8 sm:p-5 ${colorMap[color]} bg-paper/95`}>
            <h1 className="font-display text-[clamp(3.5rem,20vw,9.5rem)] font-black uppercase tracking-[-0.07em] leading-[0.8]" style={{ textShadow: `4px 4px 0 ${color === 'black' ? 'var(--color-surface)' : 'var(--color-ink)'}` }}>
              {text}
            </h1>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
