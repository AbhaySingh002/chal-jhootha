import React from 'react';
import type { Player } from 'shared';
import clsx from 'clsx';
import { useGameStore } from '../state/gameStore';

export const PlayerSeat: React.FC<{ player: Player; position: number; total: number }> = ({ player, position, total }) => {
  const { gameState, handsCount } = useGameStore();
  const isTurn = gameState?.currentTurnPlayerId === player.id;
  const isWinner = player.isWinner || player.role === 'winner_spectator';
  
  let x = 0;
  let y = -36;
  
  if (total > 1) {
    const startAngle = -Math.PI * 0.82;
    const endAngle = -Math.PI * 0.18;
    const angle = startAngle + (position / (total - 1)) * (endAngle - startAngle);
    const radiusX = Math.min(132, 65 + total * 15);
    const radiusY = 58;
    x = Math.cos(angle) * radiusX;
    y = Math.sin(angle) * radiusY + 5;
  }

  return (
    <div 
      className={clsx(
        "absolute flex flex-col items-center transition-all duration-200 z-10",
        player.isDisconnected && "opacity-60"
      )}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <div className={clsx(
        "w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center text-sm sm:text-base font-black font-display border-2 border-ink transition-transform",
        isTurn ? "bg-caution-yellow text-ink scale-110 shadow-[3px_3px_0_var(--color-ink)]" : 
        isWinner ? "bg-confirmed-green text-white shadow-[2px_2px_0_var(--color-ink)]" :
        "bg-surface text-ink shadow-[2px_2px_0_var(--color-ink)]"
      )}>
        {player.name.substring(0, 2).toUpperCase()}
      </div>
      <div className="mt-1 bg-surface border border-ink px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold font-mono text-ink uppercase shadow-[1px_1px_0_var(--color-ink)] max-w-[68px] sm:max-w-[90px] truncate">
        {player.name}
      </div>
      {isWinner ? (
        <div className="mt-0.5 bg-confirmed-green text-white border border-ink px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase shadow-[1px_1px_0_var(--color-ink)]">
          WINNER
        </div>
      ) : player.isAbandoned ? (
        <div className="mt-0.5 bg-surface-muted text-ink border border-ink px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase">
          ABANDONED
        </div>
      ) : player.isDisconnected ? (
        <div className="mt-0.5 bg-evidence-red text-white border border-ink px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase">
          AWAY
        </div>
      ) : (
        <div className="mt-0.5 flex gap-1 items-center bg-ink text-paper border border-ink px-1.5 py-0.5 text-[9px] shadow-[1px_1px_0_var(--color-ink)]">
          <span className="font-mono font-bold">{handsCount[player.id] ?? player.handCount ?? 0}</span>
          <span className="text-[8px] tracking-wider uppercase font-bold text-ink-muted">CARDS</span>
        </div>
      )}
    </div>
  );
};
