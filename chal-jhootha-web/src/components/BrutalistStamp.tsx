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
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className="pointer-events-none fixed inset-0 flex items-center justify-center z-50"
        >
          <div className={`border-8 p-4 ${colorMap[color]} bg-paper/90`}>
            <h1 className="text-8xl md:text-[150px] font-display font-black uppercase tracking-tighter leading-none" style={{ textShadow: `6px 6px 0 ${color === 'black' ? '#EDEBE3' : '#14140F'}` }}>
              {text}
            </h1>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
