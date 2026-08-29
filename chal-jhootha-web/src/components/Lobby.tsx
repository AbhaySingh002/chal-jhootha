import React, { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { Copy, Check, Users, Layers, Trophy, ArrowLeft, Shield } from 'lucide-react';
import { useLocation } from 'wouter';

export const Lobby: React.FC = () => {
  const { gameState, playerId, startGame, setConfig, resetSession } = useGameStore();
  const [copied, setCopied] = useState(false);
  const [, setLocation] = useLocation();

  const playerCount = gameState?.players.length ?? 0;
  const isHost = gameState?.hostId === playerId;
  const maxWinners = Math.max(1, playerCount - 1);
  const currentDeckCount = gameState?.deckCount || 1;
  const currentWinnerCount = gameState?.winnerCount || 1;
  const winnerCountLocked = gameState?.winnerCountLocked ?? false;

  // Ensure winnerCount is clamped within valid bounds [1, playerCount - 1] whenever playerCount changes
  useEffect(() => {
    if (!winnerCountLocked && isHost && playerCount >= 2 && currentWinnerCount > maxWinners) {
      setConfig(currentDeckCount, maxWinners);
    }
  }, [winnerCountLocked, isHost, playerCount, currentWinnerCount, maxWinners, currentDeckCount, setConfig]);

  if (!gameState || gameState.phase !== 'lobby') return null;

  const inviteUrl = `${window.location.origin}/room/${gameState.roomCode}`;

  const copyLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLeaveLobby = () => {
    resetSession();
    setLocation('/');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4 bg-paper z-10 w-full relative font-sans">
      
      {/* Top back/leave button */}
      <div className="absolute top-4 left-4 z-20">
        <button 
          onClick={handleLeaveLobby}
          className="brutal-btn py-2 px-3 bg-white text-ink text-xs sm:text-sm flex items-center gap-1.5 hover:bg-neutral-100"
          aria-label="Leave Case"
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
          <span>LEAVE</span>
        </button>
      </div>

      <div className="brutal-card max-w-lg w-full border-4 border-ink shadow-[6px_6px_0_#111111] bg-white my-8">
        {/* Header banner */}
        <div className="border-b-4 border-ink bg-ink text-paper p-5 sm:p-6 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 opacity-15 transform rotate-12 text-6xl sm:text-7xl font-display pointer-events-none select-none text-white">
            {gameState.roomCode}
          </div>
          <div className="flex items-center justify-center gap-2 mb-1">
            <Shield size={18} className="text-caution-yellow" />
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-caution-yellow">OFFICIAL CASE FILE</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-display uppercase tracking-wider relative z-10 text-white">CHAL JHOOTHA</h2>
          
          <div className="flex justify-center items-center gap-3 mt-3 relative z-10">
            <span className="text-4xl sm:text-5xl font-mono font-black bg-white text-ink px-4 py-1 border-4 border-ink shadow-[4px_4px_0_#C1272D] tracking-wider">
              {gameState.roomCode}
            </span>
            <button 
              onClick={copyLink} 
              className="brutal-btn py-2.5 px-3 bg-caution-yellow text-ink text-xs font-mono font-bold flex items-center gap-1.5 hover:brightness-105 active:translate-x-0.5 active:translate-y-0.5"
              title="Copy invite link"
            >
              {copied ? <Check size={16} strokeWidth={3} className="text-confirmed-green" /> : <Copy size={16} strokeWidth={2.5} />}
              <span>{copied ? 'COPIED!' : 'COPY'}</span>
            </button>
          </div>
        </div>
        
        <div className="p-5 sm:p-6 space-y-6">
          {/* Suspects list */}
          <div>
            <div className="flex justify-between items-center mb-3 border-b-2 border-ink/20 pb-2">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-ink" />
                <h3 className="font-mono font-bold uppercase tracking-wider text-xs sm:text-sm text-ink">
                  SUSPECTS SEATED ({playerCount}/8)
                </h3>
              </div>
              <span className="font-mono text-[11px] font-bold uppercase px-2 py-0.5 border-2 border-ink bg-paper text-ink">
                {playerCount < 2 ? 'MIN 2 NEEDED' : `${playerCount} READY`}
              </span>
            </div>
            
            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {gameState.players.map((p, i) => (
                <div 
                  key={p.id} 
                  className={`flex items-center justify-between border-2 border-ink p-2.5 sm:p-3 brutal-shadow-sm transition-colors ${
                    p.id === playerId ? 'bg-caution-yellow/15' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-evidence-red font-black text-sm">0{i + 1}</span>
                    <span className="font-mono font-bold uppercase text-ink text-sm sm:text-base truncate max-w-[180px] sm:max-w-[240px]">
                      {p.name}
                    </span>
                    {p.id === playerId && (
                      <span className="font-mono text-[10px] font-black uppercase bg-ink text-white px-1.5 py-0.5 border border-ink">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {p.id === gameState.hostId && (
                      <span className="text-[10px] sm:text-xs bg-ink text-caution-yellow px-2 py-1 font-mono font-bold border border-ink">
                        LEAD HOST
                      </span>
                    )}
                    {p.isDisconnected && (
                      <span className="text-[10px] bg-evidence-red text-white px-2 py-0.5 font-mono font-bold border border-ink">
                        AWAY
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Match Configuration / Rules Section */}
          {playerCount < 2 ? (
            /* Waiting state when only 1 player is in room */
            <div className="border-2 border-dashed border-ink p-4 bg-paper text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-ink">
                <span className="w-2.5 h-2.5 bg-evidence-red animate-ping inline-block"></span>
                <span className="font-mono text-xs sm:text-sm font-bold uppercase tracking-wider">
                  WAITING FOR 2ND SUSPECT TO JOIN...
                </span>
              </div>
              <p className="font-mono text-[11px] sm:text-xs text-ink/70 max-w-xs mx-auto">
                Game settings (Decks & Winners) will unlock once at least 2 players enter the lobby.
              </p>
              <div className="flex items-center gap-2 max-w-sm mx-auto pt-1">
                <input 
                  type="text" 
                  readOnly 
                  value={inviteUrl} 
                  className="w-full font-mono text-xs p-2 bg-white border-2 border-ink truncate select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button 
                  onClick={copyLink} 
                  className="brutal-btn py-2 px-3 bg-caution-yellow text-ink text-xs font-mono whitespace-nowrap flex-shrink-0"
                >
                  {copied ? 'COPIED!' : 'COPY'}
                </button>
              </div>
            </div>
          ) : isHost ? (
            /* Host Controls when 2+ players are seated */
            <div className="border-2 border-ink p-4 bg-paper space-y-4">
              <div className="flex items-center justify-between border-b-2 border-ink/20 pb-1.5">
                <div className="flex items-center gap-1.5">
                  <Layers size={15} className="text-ink" />
                  <span className="font-mono font-bold uppercase tracking-wider text-xs text-ink">
                    MATCH DOSSIER (HOST CONTROLS)
                  </span>
                </div>
                <span className="font-mono text-[10px] text-ink/60 font-bold uppercase">
                  ADJUST BEFORE START
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Decks selection */}
                <div className="border-2 border-ink p-2.5 bg-white shadow-[2px_2px_0_#111111]">
                  <label className="block text-[11px] font-mono font-bold uppercase text-ink mb-1.5">
                    Decks (52 Cards/Deck)
                  </label>
                  <select
                    className="w-full border-2 border-ink p-2 bg-paper font-mono font-bold text-xs sm:text-sm text-ink focus:outline-none focus:bg-caution-yellow/20 cursor-pointer"
                    value={currentDeckCount}
                    onChange={(e) => setConfig(Number(e.target.value), currentWinnerCount)}
                  >
                    <option value={1}>1 Deck (52 Cards)</option>
                    <option value={2}>2 Decks (104 Cards)</option>
                    <option value={3}>3 Decks (156 Cards)</option>
                  </select>
                </div>

                {/* Winners selection */}
                <div className="border-2 border-ink p-2.5 bg-white shadow-[2px_2px_0_#111111]">
                  <label className="block text-[11px] font-mono font-bold uppercase text-ink mb-1.5 flex items-center justify-between">
                    <span>Target Winners</span>
                    <span className={`text-[10px] font-mono ${winnerCountLocked ? 'text-confirmed-green' : 'text-evidence-red'}`}>
                      {winnerCountLocked ? 'LOCKED FOR THIS ROOM' : `(1 to ${maxWinners})`}
                    </span>
                  </label>
                  <select
                    className="w-full border-2 border-ink p-2 bg-paper font-mono font-bold text-xs sm:text-sm text-ink focus:outline-none focus:bg-caution-yellow/20 cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                    value={winnerCountLocked ? currentWinnerCount : Math.min(currentWinnerCount, maxWinners)}
                    disabled={winnerCountLocked}
                    onChange={(e) => setConfig(currentDeckCount, Number(e.target.value))}
                  >
                    {Array.from({ length: winnerCountLocked ? 1 : maxWinners }, (_, i) => winnerCountLocked ? currentWinnerCount : i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? '1 Winner (1st to Empty)' : `${n} Winners (Top ${n})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : (
            /* Guest View when 2+ players are seated */
            <div className="border-2 border-ink p-4 bg-paper space-y-2">
              <div className="flex items-center justify-between border-b-2 border-ink/20 pb-1.5">
                <div className="flex items-center gap-1.5">
                  <Trophy size={15} className="text-ink" />
                  <span className="font-mono font-bold uppercase tracking-wider text-xs text-ink">
                    MATCH RULES CONFIGURED
                  </span>
                </div>
                <span className="font-mono text-[10px] text-confirmed-green font-bold uppercase">
                  SET BY HOST
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
                <div className="border-2 border-ink p-2 bg-white flex items-center justify-between">
                  <span className="font-bold text-ink/70">DECKS:</span>
                  <span className="font-black text-ink">{currentDeckCount} ({currentDeckCount * 52} Cards)</span>
                </div>
                <div className="border-2 border-ink p-2 bg-white flex items-center justify-between">
                  <span className="font-bold text-ink/70">WINNERS:</span>
                  <span className="font-black text-ink">{currentWinnerCount} {currentWinnerCount === 1 ? 'Winner' : 'Winners'} {winnerCountLocked ? '(LOCKED)' : ''}</span>
                </div>
              </div>
            </div>
          )}

          {/* Action button */}
          {isHost ? (
            <button
              disabled={playerCount < 2}
              onClick={startGame}
              className="w-full brutal-btn text-lg sm:text-xl py-4 sm:py-5 bg-confirmed-green text-white hover:brightness-105 disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none disabled:transform-none disabled:border-neutral-400 cursor-pointer disabled:cursor-not-allowed transition-all"
            >
              {playerCount < 2 
                ? 'WAITING FOR SUSPECTS (MIN 2)' 
                : `COMMENCE INTERROGATION (${playerCount} PLAYERS)`}
            </button>
          ) : (
            <div className="border-2 border-dashed border-ink p-4 text-center bg-caution-yellow/20">
              <div className="flex items-center justify-center gap-2">
                <span className="w-2.5 h-2.5 bg-ink animate-pulse inline-block"></span>
                <p className="font-mono font-bold text-xs sm:text-sm uppercase text-ink">
                  Awaiting Lead Host to commence interrogation...
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="font-mono text-[10px] uppercase font-bold text-ink/50 tracking-widest text-center">
        CHAL JHOOTHA // REAL-TIME MULTIPLAYER EVIDENCE ENGINE
      </div>
    </div>
  );
};
