import React from 'react';
import type { Player } from 'shared';
import clsx from 'clsx';
import { useGameStore } from '../state/gameStore';

export const PlayerSeat: React.FC<{ player: Player; position: number; total: number }> = ({ player, position, total }) => {
  const { gameState, handsCount } = useGameStore();
  const isTurn = gameState?.currentTurnPlayerId === player.id;
  const isWinner = player.isWinner || player.role === 'winner_spectator';
  const presence = player.isAbandoned ? 'abandoned' : player.isDisconnected ? 'away' : 'active';
  const presenceColor = presence === 'away' ? 'bg-evidence-red' : presence === 'abandoned' ? 'bg-surface-muted' : 'bg-confirmed-green';
  const avatarMarks: Record<string, string> = {
    'ace-spades': 'A♠', 'king-hearts': 'K♥', 'queen-diamonds': 'Q♦',
    'jack-clubs': 'J♣', 'joker-red': 'JR', 'joker-black': 'JB',
  };
  const avatarMark = avatarMarks[player.avatarId || ''] || player.name.substring(0, 2).toUpperCase();

  // The ring keeps label width inside the table stage at narrow widths while
  // preserving a clear center lane for the stack and reactions.
  const seatSlots: Record<number, Array<[number, number]>> = {
    1: [[50, 24]],
    2: [[27, 31], [73, 31]],
    3: [[17, 43], [50, 24], [83, 43]],
    4: [[16, 50], [35, 31], [65, 31], [84, 50]],
    5: [[16, 52], [31, 38], [50, 24], [69, 38], [84, 52]],
  };
  const [left, top] = (seatSlots[Math.min(total, 5)]?.[position] ?? seatSlots[1][0]);

  return (
    <div
      data-player-seat-id={player.id}
      className={clsx(
        "game-player-seat absolute left-1/2 top-1/2 flex flex-col items-center transition-transform duration-300 z-10 select-none pointer-events-auto",
        player.isDisconnected && "opacity-60"
      )}
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className={clsx(
        "game-seat-avatar relative w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-sm sm:text-base font-black font-display border-2 border-ink rounded-lg transition-all",
        isTurn ? "bg-caution-yellow text-ink scale-110 shadow-[3px_3px_0_var(--color-ink)] ring-2 ring-evidence-red" :
        isWinner ? "bg-confirmed-green text-white shadow-[2px_2px_0_var(--color-ink)]" :
        "bg-surface text-ink shadow-[2px_2px_0_var(--color-ink)]"
      )}>
        {avatarMark}
        <span
          aria-label={presence === 'away' ? 'Away' : presence === 'abandoned' ? 'Abandoned' : 'Active'}
          className={clsx('absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface', presenceColor)}
          role="status"
        />
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
          <span className="font-mono font-bold">{handsCount[player.id] ?? player.handCount ?? 0}</span>
          <span className="text-[8px] tracking-wider uppercase font-bold text-ink-muted">CARDS</span>
        </div>
      )}
    </div>
  );
};
