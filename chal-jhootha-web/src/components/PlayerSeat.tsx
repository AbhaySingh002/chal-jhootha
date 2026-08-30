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

  // Calculate arc position around the central pile (upper semicircle / stadium layout)
  let angle = -Math.PI / 2; // Default 1 player: top center (-90deg)
  if (total === 2) {
    const angles = [-Math.PI * 0.75, -Math.PI * 0.25];
    angle = angles[position] ?? -Math.PI / 2;
  } else if (total > 2) {
    const startAngle = -Math.PI * 0.92; // Left flank (~-165deg)
    const endAngle = -Math.PI * 0.08;   // Right flank (~-15deg)
    angle = startAngle + (position / (total - 1)) * (endAngle - startAngle);
  }

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  return (
    <div
      data-player-seat-id={player.id}
      className={clsx(
        "absolute left-1/2 top-1/2 flex flex-col items-center transition-transform duration-300 z-10 select-none pointer-events-auto",
        player.isDisconnected && "opacity-60"
      )}
      style={{
        transform: `translate(calc(-50% + (${cosA.toFixed(4)} * min(44vw, 260px))), calc(-50% + (${sinA.toFixed(4)} * max(125px, min(35vw, 155px)))))`
      }}
    >
      <div className={clsx(
        "relative w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-sm sm:text-base font-black font-display border-2 border-ink rounded-lg transition-all",
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
      <div className="mt-1 bg-surface border border-ink px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold font-mono text-ink uppercase shadow-[1px_1px_0_var(--color-ink)] max-w-[72px] sm:max-w-[100px] truncate rounded">
        {player.name}
      </div>
      {isWinner ? (
        <div className="mt-0.5 bg-confirmed-green text-white border border-ink px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase shadow-[1px_1px_0_var(--color-ink)] rounded">
          WINNER
        </div>
      ) : (
        <div className="mt-0.5 flex gap-1 items-center bg-ink text-paper border border-ink px-1.5 py-0.5 text-[9px] shadow-[1px_1px_0_var(--color-ink)] rounded">
          <span className="font-mono font-bold">{handsCount[player.id] ?? player.handCount ?? 0}</span>
          <span className="text-[8px] tracking-wider uppercase font-bold text-ink-muted">CARDS</span>
        </div>
      )}
    </div>
  );
};
