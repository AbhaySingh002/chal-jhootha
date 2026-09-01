import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { CircleHelp, Play, SkipForward } from 'lucide-react';
import { MAX_OPENING_CARD_COUNT } from 'shared';
import type { ClaimGroup } from 'shared';
import { OpeningDeclaration } from './OpeningDeclaration';
import { useGameStore } from '../state/gameStore';

interface ActionBarProps {
  selectedCards: string[];
  clearSelection: () => void;
  declarationOpen: boolean;
  onDeclarationOpenChange: (open: boolean) => void;
}

export const ActionBar: React.FC<ActionBarProps> = ({ selectedCards, clearSelection, declarationOpen, onDeclarationOpenChange }) => {
  const { gameState, playerId, playCards, challenge, skip, youAreController, yourRole, connectionStatus, pendingAction, lastError } = useGameStore();
  const reduceMotion = useReducedMotion();

  if (!gameState || gameState.phase !== 'playing') return null;
  if (!youAreController || yourRole !== 'active') return null;
  if (connectionStatus !== 'CONNECTED') return <p className="border-2 border-ink bg-evidence-red px-3 py-2 text-center font-mono text-xs font-bold text-white">Waiting for a stable connection.</p>;
  if (pendingAction) return <p aria-live="polite" className="border-2 border-ink bg-caution-yellow px-3 py-2 text-center font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink">{pendingAction.type.replace('_', ' ')}…</p>;

  const isMyTurn = gameState.currentTurnPlayerId === playerId;
  const isOpeningPlay = isMyTurn && gameState.stackCount === 0;
  const hasSelected = selectedCards.length > 0;
  const exceedsOpeningLimit = isOpeningPlay && selectedCards.length > MAX_OPENING_CARD_COUNT;
  const activeSuspect = gameState.players.find((player) => player.id === gameState.currentTurnPlayerId)?.name || 'Another player';
  const topPlayer = gameState.players.find((player) => player.id === gameState.topPlay?.playerId)?.name || 'the last player';
  const pendingFinishPlayer = gameState.players.find((player) => player.id === gameState.pendingFinishId)?.name || 'the last player';
  const finalCalloutNotice = gameState.pendingFinishId ? <p role="status" className="mb-2 border-2 border-ink bg-caution-yellow px-3 py-2 text-center font-mono text-xs font-bold text-ink">Final callout for {pendingFinishPlayer}: Callout, Skip, or Play.</p> : null;

  const playSelected = () => {
    if (!hasSelected) return;
    if (isOpeningPlay) {
      if (!exceedsOpeningLimit) onDeclarationOpenChange(true);
      return;
    }
    playCards(selectedCards);
    clearSelection();
  };

  const confirmOpening = (claims: ClaimGroup[]) => {
    playCards(selectedCards, claims);
    clearSelection();
    onDeclarationOpenChange(false);
  };

  if (!isMyTurn) return <>{finalCalloutNotice}<p className="border-2 border-ink bg-ink px-3 py-2 text-center font-mono text-xs font-bold uppercase tracking-[0.08em] text-paper">{activeSuspect}'s turn</p></>;

  return (
    <>
      {lastError ? <p role="alert" className="mb-2 border-2 border-ink bg-evidence-red px-3 py-2 text-center font-mono text-xs font-bold text-white">{lastError}</p> : null}
      {exceedsOpeningLimit ? <p role="alert" className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.06em] text-evidence-red">Select at most 52 cards.</p> : null}
      {finalCalloutNotice}
      <AnimatePresence mode="wait">
        {declarationOpen ? (
          <OpeningDeclaration
            selectedCardCount={selectedCards.length}
            onConfirm={confirmOpening}
            onClose={() => onDeclarationOpenChange(false)}
          />
        ) : (
          <motion.div key="actions" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: reduceMotion ? 0 : 0.16 }} className="game-action-row grid grid-cols-3 gap-2">
            <button type="button" disabled={!hasSelected || exceedsOpeningLimit} onClick={playSelected} className={clsx('brutal-btn flex min-w-0 items-center justify-center gap-1.5 px-2 text-xs sm:text-sm', hasSelected && !exceedsOpeningLimit ? 'bg-caution-yellow text-ink' : 'bg-surface-muted text-ink-muted')} aria-label={hasSelected ? `Play ${selectedCards.length} selected cards` : 'Select cards to play'} title={hasSelected ? `Play ${selectedCards.length} selected cards` : 'Select cards to play'}><Play size={18} strokeWidth={2.5} /><span className="hidden sm:inline">Play {hasSelected ? selectedCards.length : ''}</span></button>
            <button type="button" disabled={!gameState.topPlay} onClick={challenge} className={clsx('brutal-btn flex min-w-0 items-center justify-center gap-1.5 px-2 text-xs sm:text-sm', gameState.topPlay ? 'bg-evidence-red text-white' : 'bg-surface-muted text-ink-muted')} aria-label={gameState.topPlay ? `Call out ${topPlayer}` : 'Nothing to call out'} title={gameState.topPlay ? `Call out ${topPlayer}` : 'Nothing to call out'}><CircleHelp size={18} strokeWidth={2.5} /><span className="hidden sm:inline">Callout</span></button>
            <button type="button" onClick={skip} className="brutal-btn flex min-w-0 items-center justify-center gap-1.5 bg-surface text-ink hover:bg-surface-muted px-2 text-xs sm:text-sm" aria-label="Skip" title="Skip"><SkipForward size={18} strokeWidth={2.5} /><span className="hidden sm:inline">Skip</span></button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
