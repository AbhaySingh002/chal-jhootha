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

export function PlayerRosterSheet({
  open,
  onClose,
  players,
  playerId,
  hostId,
  handsCount,
}: PlayerRosterSheetProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:items-center sm:p-6"
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.section
            className="safe-bottom max-h-[min(85dvh,42rem)] w-full max-w-xl overflow-y-auto border-[3px] border-ink bg-surface shadow-[6px_6px_0_var(--color-ink)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roster-title"
            initial={reduceMotion ? false : { y: 32 }}
            animate={{ y: 0 }}
            exit={{ y: 32 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b-[3px] border-ink bg-surface px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-2">
                <Users size={20} strokeWidth={2.5} />
                <h2 id="roster-title" className="font-display text-xl uppercase">
                  Players Seated
                </h2>
                <span className="border-2 border-ink bg-caution-yellow px-2 py-0.5 font-mono text-xs font-bold">
                  {players.length}
                </span>
              </div>
              <button type="button" className="icon-btn h-8 w-8" onClick={onClose} aria-label="Close roster">
                <X size={18} strokeWidth={2.5} />
              </button>
            </header>

            <ul className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4">
              {players.map((player, index) => {
                const isYou = player.id === playerId;
                const isWinner = player.isWinner || player.role === 'winner_spectator';
                const cardCount = handsCount[player.id] ?? player.handCount ?? 0;
                return (
                  <li
                    key={player.id}
                    className="flex min-w-0 items-center gap-3 border-2 border-ink bg-paper p-3 shadow-[2px_2px_0_var(--color-ink)]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-ink bg-surface font-display text-sm text-evidence-red">
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-mono text-sm font-bold uppercase">{player.name}</p>
                        {isYou && (
                          <span className="border border-ink bg-caution-yellow px-1 py-0.2 font-mono text-[9px] font-bold">
                            YOU
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-ink-muted">
                        {player.isDisconnected ? <WifiOff size={12} strokeWidth={2.5} /> : null}
                        {player.isDisconnected ? 'Away' : player.isAbandoned ? 'Abandoned' : `${cardCount} cards`}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isWinner && (
                        <Trophy className="shrink-0 text-confirmed-green" size={18} strokeWidth={2.5} aria-label="Winner" />
                      )}
                      {!isWinner && player.id === hostId && (
                        <Crown className="shrink-0 text-caution-yellow" size={18} strokeWidth={2.5} aria-label="Host" />
                      )}
                    </div>
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
