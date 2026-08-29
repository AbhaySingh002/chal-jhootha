import React from 'react';
import type { Player } from 'shared';
import clsx from 'clsx';
import { useGameStore } from '../state/gameStore';

export const PlayerSeat: React.FC<{ player: Player; position: number; total: number }> = ({ player, position, total }) => {
  const { gameState, handsCount } = useGameStore();
  const isTurn = gameState?.currentTurnPlayerId === player.id;
  const isWinner = player.isWinner || player.role === 'winner_spectator';
  
  let x = 0;
  let y = -40;
  
  if (total > 1) {
    const startAngle = -Math.PI * 0.82;
    const endAngle = -Math.PI * 0.18;
    const angle = startAngle + (position / (total - 1)) * (endAngle - startAngle);
    const radiusX = Math.min(180, 80 + total * 20);
    const radiusY = 70;
    x = Math.cos(angle) * radiusX;
    y = Math.sin(angle) * radiusY + 5;
  }

  return (
    <div 
      className={clsx(
        "absolute flex flex-col items-center transition-all duration-300 z-10",
        player.isDisconnected && "opacity-60"
      )}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <div className={clsx(
        "w-9 h-9 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center text-sm sm:text-base font-black font-display border-2 border-ink transition-transform",
        isTurn ? "bg-caution-yellow text-ink scale-110 shadow-[3px_3px_0_#111111] animate-pulse" : 
        isWinner ? "bg-confirmed-green text-white shadow-[2px_2px_0_#111111]" :
        "bg-white text-ink shadow-[2px_2px_0_#111111]"
      )}>
        {player.name.substring(0, 2).toUpperCase()}
      </div>
      <div className="mt-1 bg-white border border-ink px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold font-mono text-ink uppercase rounded shadow-[1px_1px_0_#111111] max-w-[75px] sm:max-w-[95px] truncate">
        {player.name}
      </div>
      {isWinner ? (
        <div className="mt-0.5 bg-confirmed-green text-white border border-ink px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase rounded shadow-[1px_1px_0_#111111]">
          WINNER
        </div>
      ) : player.isAbandoned ? (
        <div className="mt-0.5 bg-neutral-400 text-white border border-ink px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase rounded">
          ABANDONED
        </div>
      ) : player.isDisconnected ? (
        <div className="mt-0.5 bg-evidence-red text-white border border-ink px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase rounded animate-pulse">
          AWAY
        </div>
      ) : (
        <div className="mt-0.5 flex gap-1 items-center bg-ink text-white border border-ink px-1.5 py-0.5 text-[9px] rounded shadow-[1px_1px_0_#111111]">
          <span className="font-mono font-bold">{handsCount[player.id] ?? player.handCount ?? 0}</span>
          <span className="text-[8px] tracking-wider uppercase font-bold text-neutral-300">CARDS</span>
        </div>
      )}
    </div>
  );
};
