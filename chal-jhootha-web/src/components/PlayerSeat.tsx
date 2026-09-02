import React from 'react';
import type { Player } from 'shared';
import clsx from 'clsx';
import { WifiOff } from 'lucide-react';
import { useGameStore } from '../state/gameStore';
import { useTurnTimer } from '../hooks/useTurnTimer';

export const PlayerSeat: React.FC<{ player: Player; position: number; total: number }> = ({ player, position, total }) => {
  const { gameState, handsCount } = useGameStore();
  const isTurn = gameState?.currentTurnPlayerId === player.id;
  const isWinner = player.isWinner || player.role === 'winner_spectator';
  const isDisconnected = player.isDisconnected;
  const { progress, isUrgent } = useTurnTimer(isTurn ? gameState?.turnDeadlineUnixMs : null, gameState?.turnDurationMs);

  const avatarMarks: Record<string, string> = {
    'ace-spades': 'A♠', 'king-hearts': 'K♥', 'queen-diamonds': 'Q♦',
    'jack-clubs': 'J♣', 'joker-red': 'JR', 'joker-black': 'JB',
  };
  const avatarMark = avatarMarks[player.avatarId || ''] || player.name.substring(0, 2).toUpperCase();

  // The ring positions seats cleanly around the perimeter of the table stage,
  // providing generous vertical breathing room above the central evidence pile.
  const seatSlots: Record<number, Array<[number, number]>> = {
    1: [[50, 13]],
    2: [[24, 17], [76, 17]],
    3: [[16, 36], [50, 13], [84, 36]],
    4: [[14, 46], [32, 17], [68, 17], [86, 46]],
    5: [[14, 48], [28, 22], [50, 13], [72, 22], [86, 48]],
  };
  const [left, top] = (seatSlots[Math.min(total, 5)]?.[position] ?? seatSlots[1][0]);

  return (
    <div
      data-player-seat-id={player.id}
      className={clsx(
        "game-player-seat absolute left-1/2 top-1/2 flex flex-col items-center transition-transform duration-300 z-10 select-none pointer-events-auto",
        isDisconnected && "opacity-65"
      )}
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className={clsx(
        "game-seat-avatar relative w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-sm sm:text-base font-black font-display border-2 border-ink rounded-lg transition-all",
        isTurn ? "bg-caution-yellow text-ink scale-110 shadow-[3px_3px_0_var(--color-ink)]" :
        isWinner ? "bg-confirmed-green text-white shadow-[2px_2px_0_var(--color-ink)]" :
        "bg-surface text-ink shadow-[2px_2px_0_var(--color-ink)]"
      )}>
        {/* Perimeter countdown halo (clockwise draining, no digits) */}
        {isTurn && gameState?.turnDeadlineUnixMs && (
          <svg
            className="absolute -inset-1.5 w-[calc(100%+12px)] h-[calc(100%+12px)] pointer-events-none -rotate-90 z-10"
            viewBox="0 0 100 100"
          >
            <rect
              x="4"
              y="4"
              width="92"
              height="92"
              rx="14"
              ry="14"
              fill="none"
              stroke="currentColor"
              className={clsx(
                "transition-colors duration-200",
                isUrgent ? "text-evidence-red animate-pulse" : "text-ink"
              )}
              strokeWidth="4.5"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 * (1 - progress)}
              strokeLinecap="round"
            />
          </svg>
        )}

        {avatarMark}
        {isDisconnected ? (
          <span aria-label="Disconnected" title="Disconnected" className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface bg-evidence-red text-white z-20" role="status">
            <WifiOff size={11} strokeWidth={3} aria-hidden="true" />
          </span>
        ) : (
          <span aria-label="Connected" className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface bg-confirmed-green z-20" role="status" />
        )}
      </div>
      <div className="game-seat-name mt-1 bg-surface border border-ink px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold font-mono text-ink uppercase shadow-[1px_1px_0_var(--color-ink)] max-w-[72px] sm:max-w-[100px] truncate rounded">
        {player.name}
      </div>
      {isWinner ? (
        <div className="mt-0.5 bg-confirmed-green text-white border border-ink px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase shadow-[1px_1px_0_var(--color-ink)] rounded">
          WINNER
        </div>
      ) : (
        <div className="game-seat-cards mt-0.5 flex gap-1 items-center bg-ink text-paper border border-ink px-1.5 py-0.5 text-[9px] shadow-[1px_1px_0_var(--color-ink)] rounded">
          <span className="font-mono font-bold leading-none">{handsCount[player.id] ?? player.handCount ?? 0}</span>
          <span className="text-[7.5px] sm:text-[8px] tracking-wider uppercase font-bold opacity-80 leading-none">CARDS</span>
        </div>
      )}
    </div>
  );
};
