import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Crown, Trophy, Users, WifiOff, X } from 'lucide-react';
import type { Player } from 'shared';

type PlayerRosterSheetProps = {
  open: boolean;
  onClose: () => void;
  players: Player[];
  playerId: string | null;
  hostId: string;
  handsCount: Record<string, number>;
};

export function PlayerRosterSheet({ open, onClose, players, playerId, hostId, handsCount }: PlayerRosterSheetProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end bg-ink/60 p-3 pt-16 sm:items-center sm:justify-center sm:p-6"
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.section
            className="safe-bottom max-h-[min(78dvh,42rem)] w-full max-w-xl overflow-y-auto border-[3px] border-ink bg-surface shadow-[6px_6px_0_var(--color-ink)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roster-title"
            initial={reduceMotion ? false : { y: 32 }}
            animate={{ y: 0 }}
            exit={{ y: 32 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <header className="sticky top-0 flex items-center justify-between gap-4 border-b-[3px] border-ink bg-surface px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-2">
                <Users size={20} strokeWidth={2.5} />
                <h2 id="roster-title" className="font-display text-xl uppercase">Players seated</h2>
                <span className="border-2 border-ink bg-caution-yellow px-2 py-0.5 font-mono text-xs font-bold">{players.length}</span>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close player roster">
                <X size={20} strokeWidth={2.5} />
              </button>
            </header>
            <ul className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4">
              {players.map((player, index) => {
                const isYou = player.id === playerId;
                const isWinner = player.isWinner || player.role === 'winner_spectator';
                const cardCount = handsCount[player.id] ?? player.handCount ?? 0;
                return (
                  <li key={player.id} className="flex min-w-0 items-center gap-3 border-2 border-ink bg-paper p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-ink bg-surface font-display text-sm">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-mono text-sm font-bold uppercase">{player.name}</p>
                        {isYou ? <span className="border border-ink bg-caution-yellow px-1.5 py-0.5 font-mono text-[10px] font-bold">YOU</span> : null}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-ink-muted">
                        {player.isDisconnected ? <WifiOff size={13} strokeWidth={2.5} /> : null}
                        {player.isDisconnected ? 'Away' : player.isAbandoned ? 'Abandoned' : `${cardCount} cards`}
                      </p>
                    </div>
                    {isWinner ? <Trophy className="shrink-0 text-confirmed-green" size={19} strokeWidth={2.5} aria-label="Winner" /> : null}
                    {!isWinner && player.id === hostId ? <Crown className="shrink-0 text-caution-yellow" size={19} strokeWidth={2.5} aria-label="Host" /> : null}
                  </li>
                );
              })}
            </ul>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
