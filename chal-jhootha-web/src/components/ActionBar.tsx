import React, { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const ActionBar: React.FC<{
  selectedCards: string[];
  clearSelection: () => void;
}> = ({ selectedCards, clearSelection }) => {
  const { gameState, playerId, playCards, challenge, skip, youAreController, yourRole, connectionStatus } = useGameStore();
  const [challengeConfirm, setChallengeConfirm] = useState(false);
  const [isSelectingRank, setIsSelectingRank] = useState(false);

  useEffect(() => {
    if (!challengeConfirm) return;
    const timer = setTimeout(() => setChallengeConfirm(false), 2000);
    return () => clearTimeout(timer);
  }, [challengeConfirm]);

  if (!gameState || gameState.phase !== 'playing') return null;
  if (!youAreController || yourRole === 'winner_spectator' || yourRole === 'abandoned') return null;
  if (connectionStatus !== 'CONNECTED') return null;

  const isMyTurn = gameState.currentTurnPlayerId === playerId;
  const isOpener = gameState.roundOpenerId === playerId;
  const hasSelected = selectedCards.length > 0;
  
  if (!isMyTurn) {
    const activeSuspect = gameState.players.find(p => p.id === gameState.currentTurnPlayerId)?.name || 'SUSPECT';
    return (
      <div className="fixed bottom-28 sm:bottom-36 left-0 right-0 flex justify-center px-4 pointer-events-none z-20">
        <motion.div
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 15, opacity: 0 }}
          className="bg-ink text-paper px-3 py-1.5 border-2 border-ink shadow-[2px_2px_0_#111111] rounded font-mono text-xs sm:text-sm font-bold uppercase tracking-wider pointer-events-auto flex items-center gap-2"
        >
          <span className="w-2 h-2 bg-caution-yellow animate-ping inline-block rounded-full"></span>
          <span>{activeSuspect}</span>
        </motion.div>
      </div>
    );
  }

  const handlePlayClick = (e: React.MouseEvent) => {
    if (!hasSelected) {
      e.preventDefault();
      return;
    }
    
    if (isOpener && gameState.stackCount === 0) {
      setIsSelectingRank(true);
    } else {
      playCards(selectedCards, gameState.claimedRank as any);
      clearSelection();
    }
  };

  const handleRankSelect = (rank: string) => {
    playCards(selectedCards, rank as any);
    clearSelection();
    setIsSelectingRank(false);
  };

  return (
    <div className="fixed bottom-28 sm:bottom-36 left-0 right-0 flex justify-center px-3 pointer-events-none z-20">
      <AnimatePresence mode="wait">
        {isSelectingRank ? (
          <motion.div
            key="rank-selector"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="w-full max-w-md pointer-events-auto"
          >
            <div className="bg-white border-2 sm:border-3 border-ink shadow-[3px_3px_0_#111111] p-3 rounded-lg flex flex-col gap-2">
              <div className="flex justify-between items-center px-1">
                <span className="font-display font-black text-ink uppercase tracking-wider text-xs sm:text-sm">Select Claimed Rank</span>
                <button 
                  onClick={() => setIsSelectingRank(false)}
                  className="font-mono text-xs font-bold text-evidence-red hover:text-ink transition-colors underline"
                >
                  CANCEL
                </button>
              </div>
              
              <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2 pt-1 px-1 no-scrollbar scroll-smooth snap-x touch-pan-x">
                {RANKS.map(rank => (
                  <motion.button
                    key={rank}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => handleRankSelect(rank)}
                    className="flex-shrink-0 w-12 h-16 sm:w-14 sm:h-18 snap-center border-2 border-ink bg-paper rounded flex items-center justify-center text-xl sm:text-2xl font-black font-sans shadow-[2px_2px_0_#111111] hover:bg-caution-yellow transition-colors"
                  >
                    {rank}
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="action-buttons"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="bg-white border-2 sm:border-3 border-ink shadow-[3px_3px_0_#111111] p-2 sm:p-2.5 flex gap-2 pointer-events-auto rounded-lg"
          >
            <button
              className={clsx(
                "brutal-btn min-w-[75px] sm:min-w-[105px] py-2 px-2.5 sm:py-3 sm:px-4 rounded text-xs sm:text-base border-2 shadow-[2px_2px_0_#111111]",
                !hasSelected ? "bg-neutral-200 text-neutral-400 opacity-50 shadow-none transform-none border-neutral-300" : "bg-caution-yellow text-ink"
              )}
              aria-disabled={!hasSelected}
              aria-label={!hasSelected ? "Play cards (none selected)" : `Play ${selectedCards.length} cards`}
              onClick={handlePlayClick}
            >
              {!hasSelected 
                ? 'PLAY' 
                : (isOpener && gameState.stackCount === 0) 
                  ? `PLAY (${selectedCards.length})` 
                  : `PLAY (${selectedCards.length})`
              }
            </button>

            <button
              className={clsx(
                "brutal-btn min-w-[75px] sm:min-w-[105px] py-2 px-2.5 sm:py-3 sm:px-4 rounded text-xs sm:text-base border-2 shadow-[2px_2px_0_#111111]",
                gameState.stackCount === 0 ? "bg-neutral-200 text-neutral-400 opacity-50 shadow-none transform-none border-neutral-300" : 
                challengeConfirm ? "bg-ink text-evidence-red animate-pulse" : "bg-evidence-red text-white"
              )}
              aria-disabled={gameState.stackCount === 0}
              aria-label={gameState.stackCount === 0 ? "Challenge (stack is empty)" : challengeConfirm ? "Tap again to confirm Challenge" : "Challenge"}
              onClick={(e) => {
                if (gameState.stackCount === 0) {
                  e.preventDefault();
                  return;
                }
                if (challengeConfirm) {
                  challenge();
                  setChallengeConfirm(false);
                } else {
                  setChallengeConfirm(true);
                }
              }}
            >
              {challengeConfirm ? 'SURE?' : 'CALLOUT'}
            </button>

            <button
              className="brutal-btn bg-ink text-white rounded py-2 px-2.5 sm:py-3 sm:px-4 text-xs sm:text-base border-2 shadow-[2px_2px_0_#111111]"
              onClick={skip}
              aria-label="Skip turn"
            >
              SKIP
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
