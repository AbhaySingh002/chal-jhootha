import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { CircleHelp, Play, Plus, SkipForward, X, Minus } from 'lucide-react';
import type { ClaimGroup, Rank } from 'shared';
import { useGameStore } from '../state/gameStore';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const ActionBar: React.FC<{ selectedCards: string[]; clearSelection: () => void }> = ({ selectedCards, clearSelection }) => {
  const { gameState, playerId, playCards, challenge, skip, youAreController, yourRole, connectionStatus, pendingAction, lastError } = useGameStore();
  const [isSelectingClaims, setIsSelectingClaims] = useState(false);
  const [claims, setClaims] = useState<ClaimGroup[]>([]);
  const reduceMotion = useReducedMotion();

  if (!gameState || gameState.phase !== 'playing') return null;
  if (!youAreController || yourRole === 'winner_spectator' || yourRole === 'abandoned') return null;
  if (connectionStatus !== 'CONNECTED') return <p className="border-2 border-ink bg-evidence-red px-3 py-2 text-center font-mono text-xs font-bold text-white">Waiting for a stable connection.</p>;

  if (pendingAction) {
    return <p aria-live="polite" className="border-2 border-ink bg-caution-yellow px-3 py-2 text-center font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink">{pendingAction.type.replace('_', ' ')}…</p>;
  }

  const isMyTurn = gameState.currentTurnPlayerId === playerId;
  const isOpener = gameState.roundOpenerId === playerId;
  const hasSelected = selectedCards.length > 0;
  const activeSuspect = gameState.players.find((player) => player.id === gameState.currentTurnPlayerId)?.name || 'Another player';
  const topPlayer = gameState.players.find((player) => player.id === gameState.topPlay?.playerId)?.name || 'the last player';
  const pendingFinishPlayer = gameState.players.find((player) => player.id === gameState.pendingFinishId)?.name || 'the last player';
  const claimsTotal = claims.reduce((total, claim) => total + claim.count, 0);
  const hasDuplicateClaimRank = new Set(claims.map((claim) => claim.rank)).size !== claims.length;
  const claimsAreValid = claims.length > 0 && claimsTotal === selectedCards.length && !hasDuplicateClaimRank;
  const finalCalloutNotice = gameState.pendingFinishId ? <p role="status" className="mb-2 border-2 border-ink bg-caution-yellow px-3 py-2 text-center font-mono text-xs font-bold text-ink">Final callout for {pendingFinishPlayer}: Callout, Skip, or Play.</p> : null;

  const playSelected = () => {
    if (!hasSelected) return;
    if (isOpener && gameState.stackCount === 0) {
      setClaims([{ rank: '2', count: selectedCards.length }]);
      setIsSelectingClaims(true);
      return;
    }
    playCards(selectedCards);
    clearSelection();
  };

  const submitClaims = () => {
    if (!claimsAreValid) return;
    playCards(selectedCards, claims);
    clearSelection();
    setClaims([]);
    setIsSelectingClaims(false);
  };

  const updateClaim = (index: number, change: Partial<ClaimGroup>) => {
    setClaims((current) => current.map((claim, claimIndex) => claimIndex === index ? { ...claim, ...change } : claim));
  };

  if (!isMyTurn) {
    return <>{finalCalloutNotice}<p className="border-2 border-ink bg-ink px-3 py-2 text-center font-mono text-xs font-bold uppercase tracking-[0.08em] text-paper">{activeSuspect}'s turn</p></>;
  }

  return (
    <>
      {lastError ? <p role="alert" className="mb-2 border-2 border-ink bg-evidence-red px-3 py-2 text-center font-mono text-xs font-bold text-white">{lastError}</p> : null}
      {finalCalloutNotice}
      <AnimatePresence mode="wait">
      {isSelectingClaims ? (
        <motion.div key="claim-composer" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18 }} className="game-claim-composer border-3 border-ink bg-surface p-3 shadow-[4px_4px_0_var(--color-ink)] sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="font-display text-lg uppercase">Declare your play</p><p className="font-mono text-xs text-ink-muted">Claim counts must equal {selectedCards.length}. The last group locks the round rank.</p></div><button type="button" onClick={() => { setIsSelectingClaims(false); setClaims([]); }} className="icon-btn" aria-label="Cancel claim selection"><X size={19} strokeWidth={2.5} /></button></div>
          <div className="space-y-2" aria-label="Opening claims">
            {claims.map((claim, index) => <div key={`${claim.rank}-${index}`} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-2 border-2 border-ink bg-paper p-2">
              <label className="sr-only" htmlFor={`claim-rank-${index}`}>Claimed rank {index + 1}</label>
              <select id={`claim-rank-${index}`} value={claim.rank} onChange={(event) => updateClaim(index, { rank: event.target.value as Rank })} className="brutal-select h-11 min-w-0 bg-surface font-display text-base"><option value="" disabled>Rank</option>{RANKS.map((rank) => <option key={rank} value={rank}>{rank}</option>)}</select>
              <label className="sr-only" htmlFor={`claim-count-${index}`}>Count for {claim.rank}</label>
              <div className="flex items-center brutal-input h-11 p-0 overflow-hidden bg-surface select-none">
                <button type="button" disabled={claim.count <= 1} onClick={() => updateClaim(index, { count: Math.max(1, claim.count - 1) })} className="flex-1 flex justify-center items-center h-full hover:bg-paper disabled:opacity-30 border-r-2 border-ink active:bg-ink active:text-white" aria-label="Decrease count"><Minus size={16} strokeWidth={2.5} /></button>
                <span id={`claim-count-${index}`} className="w-9 text-center font-mono font-bold">{claim.count}</span>
                <button type="button" disabled={claim.count >= selectedCards.length} onClick={() => updateClaim(index, { count: Math.min(selectedCards.length, claim.count + 1) })} className="flex-1 flex justify-center items-center h-full hover:bg-paper disabled:opacity-30 border-l-2 border-ink active:bg-ink active:text-white" aria-label="Increase count"><Plus size={16} strokeWidth={2.5} /></button>
              </div>
              {claims.length > 1 ? <button type="button" className="icon-btn h-11 w-11" onClick={() => setClaims((current) => current.filter((_, claimIndex) => claimIndex !== index))} aria-label={`Remove ${claim.rank} group`}><X size={18} strokeWidth={2.5} /></button> : <span className="w-11" />}
            </div>)}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={claims.length >= selectedCards.length || claims.length >= RANKS.length} onClick={() => setClaims((current) => [...current, { rank: RANKS.find((rank) => !current.some((claim) => claim.rank === rank)) as Rank, count: 1 }])} className="brutal-btn flex min-h-11 items-center justify-center gap-1.5 bg-surface text-xs text-ink"><Plus size={16} strokeWidth={2.5} />Add rank group</button>
            <button type="button" disabled={!claimsAreValid} onClick={submitClaims} className="brutal-btn flex min-h-11 flex-1 items-center justify-center gap-1.5 bg-caution-yellow text-xs text-ink"><Play size={16} strokeWidth={2.5} />Play {selectedCards.length} cards</button>
          </div>
          {!claimsAreValid ? <p role="alert" className="mt-2 font-mono text-xs font-bold text-evidence-red">Make each rank unique and claim exactly {selectedCards.length} cards.</p> : null}
        </motion.div>
      ) : (
        <motion.div key="actions" initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.16 }} className="game-action-row grid grid-cols-3 gap-2">
          <button type="button" disabled={!hasSelected} onClick={playSelected} className={clsx('brutal-btn flex min-w-0 items-center justify-center gap-1.5 px-2 text-xs sm:text-sm', hasSelected ? 'bg-caution-yellow text-ink' : 'bg-surface-muted text-ink-muted')} aria-label={hasSelected ? `Play ${selectedCards.length} selected cards` : 'Select cards to play'}><Play size={17} strokeWidth={2.5} /><span>{hasSelected ? `Play ${selectedCards.length}` : 'Play'}</span></button>
          <button type="button" disabled={!gameState.topPlay} onClick={challenge} className={clsx('brutal-btn flex min-w-0 items-center justify-center gap-1.5 px-2 text-xs sm:text-sm', gameState.topPlay ? 'bg-evidence-red text-white' : 'bg-surface-muted text-ink-muted')} aria-label={gameState.topPlay ? `Call out ${topPlayer}` : 'Nothing to call out'}><CircleHelp size={17} strokeWidth={2.5} /><span>{gameState.topPlay ? 'Callout' : 'Callout'}</span></button>
          <button type="button" onClick={skip} className="brutal-btn flex min-w-0 items-center justify-center gap-1.5 bg-ink px-2 text-xs text-white sm:text-sm"><SkipForward size={17} strokeWidth={2.5} /><span>Skip</span></button>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
};
