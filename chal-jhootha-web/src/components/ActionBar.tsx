import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { CircleHelp, Play, SkipForward, X } from 'lucide-react';
import { useGameStore } from '../state/gameStore';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const ActionBar: React.FC<{ selectedCards: string[]; clearSelection: () => void }> = ({ selectedCards, clearSelection }) => {
  const { gameState, playerId, playCards, challenge, skip, youAreController, yourRole, connectionStatus } = useGameStore();
  const [challengeConfirm, setChallengeConfirm] = useState(false);
  const [isSelectingRank, setIsSelectingRank] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!challengeConfirm) return;
    const timer = window.setTimeout(() => setChallengeConfirm(false), 2000);
    return () => window.clearTimeout(timer);
  }, [challengeConfirm]);

  if (!gameState || gameState.phase !== 'playing') return null;
  if (!youAreController || yourRole === 'winner_spectator' || yourRole === 'abandoned') return null;
  if (connectionStatus !== 'CONNECTED') return <p className="border-2 border-ink bg-evidence-red px-3 py-2 text-center font-mono text-xs font-bold text-white">Waiting for a stable connection.</p>;

  const isMyTurn = gameState.currentTurnPlayerId === playerId;
  const isOpener = gameState.roundOpenerId === playerId;
  const hasSelected = selectedCards.length > 0;
  const activeSuspect = gameState.players.find((player) => player.id === gameState.currentTurnPlayerId)?.name || 'Another player';

  const playSelected = () => {
    if (!hasSelected) return;
    if (isOpener && gameState.stackCount === 0) {
      setIsSelectingRank(true);
      return;
    }
    playCards(selectedCards, gameState.claimedRank as any);
    clearSelection();
  };

  const chooseRank = (rank: string) => {
    playCards(selectedCards, rank as any);
    clearSelection();
    setIsSelectingRank(false);
  };

  if (!isMyTurn) {
    return <p className="border-2 border-ink bg-ink px-3 py-2 text-center font-mono text-xs font-bold uppercase tracking-[0.08em] text-paper">{activeSuspect}'s turn</p>;
  }

  return (
    <AnimatePresence mode="wait">
      {isSelectingRank ? (
        <motion.div key="rank-picker" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18 }} className="border-3 border-ink bg-surface p-3 shadow-[4px_4px_0_var(--color-ink)]">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="font-display text-lg uppercase">Choose a rank</p><p className="font-mono text-xs text-ink-muted">Your first play sets the claim.</p></div><button type="button" onClick={() => setIsSelectingRank(false)} className="icon-btn" aria-label="Cancel rank selection"><X size={19} strokeWidth={2.5} /></button></div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Ranks" onKeyDown={(event) => { const btns = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'); const idx = Array.from(btns).indexOf(document.activeElement as HTMLButtonElement); if (event.key === 'ArrowRight' && idx < btns.length - 1) { event.preventDefault(); btns[idx + 1].focus(); } if (event.key === 'ArrowLeft' && idx > 0) { event.preventDefault(); btns[idx - 1].focus(); } }}>
            {RANKS.map((rank) => <button type="button" role="option" key={rank} onClick={() => chooseRank(rank)} className="flex h-12 min-w-12 snap-center items-center justify-center border-2 border-ink bg-paper font-display text-lg shadow-[2px_2px_0_var(--color-ink)] active:translate-x-0.5 active:translate-y-0.5">{rank}</button>)}
          </div>
        </motion.div>
      ) : (
        <motion.div key="actions" initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.16 }} className="grid grid-cols-3 gap-2">
          <button type="button" disabled={!hasSelected} onClick={playSelected} className={clsx('brutal-btn flex min-w-0 items-center justify-center gap-1.5 px-2 text-xs sm:text-sm', hasSelected ? 'bg-caution-yellow text-ink' : 'bg-surface-muted text-ink-muted')} aria-label={hasSelected ? `Play ${selectedCards.length} selected cards` : 'Select cards to play'}><Play size={17} strokeWidth={2.5} /><span>{hasSelected ? `Play ${selectedCards.length}` : 'Play'}</span></button>
          <button type="button" disabled={gameState.stackCount === 0} onClick={() => { if (challengeConfirm) { challenge(); setChallengeConfirm(false); } else setChallengeConfirm(true); }} className={clsx('brutal-btn flex min-w-0 items-center justify-center gap-1.5 px-2 text-xs sm:text-sm', gameState.stackCount === 0 ? 'bg-surface-muted text-ink-muted' : challengeConfirm ? 'bg-ink text-caution-yellow' : 'bg-evidence-red text-white')}><CircleHelp size={17} strokeWidth={2.5} /><span>{challengeConfirm ? 'Confirm' : 'Callout'}</span></button>
          <button type="button" onClick={skip} className="brutal-btn flex min-w-0 items-center justify-center gap-1.5 bg-ink px-2 text-xs text-white sm:text-sm"><SkipForward size={17} strokeWidth={2.5} /><span>Skip</span></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
