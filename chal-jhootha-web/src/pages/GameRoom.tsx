import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'wouter';
import { useGameStore } from '../state/gameStore';
import { useSession } from '../lib/auth';
import { PlayerSeat } from '../components/PlayerSeat';
import { Stack } from '../components/Stack';
import { Hand } from '../components/Hand';
import { ActionBar } from '../components/ActionBar';
import { Lobby } from '../components/Lobby';
import { BrutalistStamp } from '../components/BrutalistStamp';
import { RoomVoice } from '../voice/voice';
import { LogOut, Mic, MicOff, Volume2, VolumeX, RotateCcw } from 'lucide-react';

export const GameRoom: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const { 
    gameState, 
    isConnected, 
    connectionStatus, 
    playerId, 
    roomCode, 
    joinRoom, 
    resetSession, 
    resetToLobby,
    lastError, 
    lastChallengeResult, 
    lastBurned, 
    sendVoice, 
    yourRole 
  } = useGameStore();

  const isReconnecting = connectionStatus === 'RECONNECTING' || connectionStatus === 'OFFLINE';
  const { data: session } = useSession();
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const hasAttemptedJoin = useRef(false);
  const [pendingName, setPendingName] = useState('');
  const [joinedName, setJoinedName] = useState<string | null>(null);
  const [connectionTimeout, setConnectionTimeout] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const voiceRef = useRef<RoomVoice | null>(null);

  const storedToken = typeof window !== 'undefined' ? sessionStorage.getItem('rejoinToken') : null;
  const storedRoom = typeof window !== 'undefined' ? sessionStorage.getItem('roomCode') : null;
  const hasValidSession = (storedRoom === code && !!storedToken) || !!session?.user?.name || !!joinedName;
  const needsName = !hasValidSession && !gameState;

  useEffect(() => {
    if (!playerId) return;
    const voice = new RoomVoice(playerId, sendVoice);
    voiceRef.current = voice;
    return () => voice.leave();
  }, [playerId, sendVoice]);

  useEffect(() => {
    if (!isConnected || gameState) {
      return;
    }
    const timer = setTimeout(() => {
      setConnectionTimeout(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [isConnected, gameState]);

  useEffect(() => {
    if (!code || hasAttemptedJoin.current) return;

    if (isConnected && gameState && roomCode === code) {
      hasAttemptedJoin.current = true;
      return;
    }

    const sRoom = sessionStorage.getItem('roomCode');
    const sToken = sessionStorage.getItem('rejoinToken');
    
    if (sRoom === code && sToken) {
      hasAttemptedJoin.current = true;
      joinRoom(code, session?.user?.name || 'REJOIN');
    } else if (session?.user?.name) {
      hasAttemptedJoin.current = true;
      joinRoom(code, session.user.name);
    } else if (joinedName) {
      hasAttemptedJoin.current = true;
      joinRoom(code, joinedName);
    }
  }, [code, roomCode, isConnected, gameState, session, joinRoom, joinedName]);

  const handleManualJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingName.trim() || !code) return;
    setJoinedName(pendingName.trim().toUpperCase());
  };

  const toggleSelect = (id: string) => {
    setSelectedCards(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleMic = async () => {
    if (!voiceOn) {
      try {
        await voiceRef.current?.join();
        setVoiceOn(true);
        setMicMuted(false);
        voiceRef.current?.setMuted(false);
      } catch {
        /* mic permission denied */
      }
    } else {
      const nextMuted = !micMuted;
      setMicMuted(nextMuted);
      voiceRef.current?.setMuted(nextMuted);
    }
  };

  const toggleSpeaker = () => {
    if (!voiceOn) {
      toggleMic();
      return;
    }
    setSpeakerMuted(prev => !prev);
  };

  const handleLeaveGame = () => {
    resetSession();
    setLocation('/');
  };

  if (lastError && !gameState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-paper p-4 text-center">
        <div className="brutal-card p-8 border-evidence-red border-4">
          <h2 className="text-3xl font-display uppercase mb-4 text-evidence-red">Error</h2>
          <p className="font-bold mb-8">{lastError}</p>
          <button onClick={() => setLocation('/')} className="brutal-btn bg-ink text-white w-full">Return Home</button>
        </div>
      </div>
    );
  }

  if (needsName) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-paper p-4">
        <div className="brutal-card p-8 bg-white max-w-sm w-full">
          <h2 className="text-2xl font-display uppercase mb-2">Join Case</h2>
          <p className="font-mono text-sm mb-6 opacity-70">Enter an alias to join this game.</p>
          <form onSubmit={handleManualJoin} className="space-y-4">
            <input
              type="text"
              maxLength={10}
              placeholder="YOUR NAME"
              value={pendingName}
              onChange={e => setPendingName(e.target.value.toUpperCase())}
              className="w-full brutal-input text-center text-xl uppercase placeholder:text-ink/30"
              autoFocus
            />
            <button 
              type="submit"
              disabled={!pendingName.trim()}
              className="w-full brutal-btn bg-caution-yellow text-ink disabled:bg-neutral-300 disabled:shadow-none"
            >
              JOIN GAME
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-paper">
        {connectionTimeout ? (
          <div className="text-center">
            <div className="font-display text-3xl text-evidence-red mb-4">CONNECTION FAILED</div>
            <p className="font-mono text-sm mb-6">Server accepted connection but did not send game state.</p>
            <button onClick={() => { sessionStorage.clear(); window.location.href = '/'; }} className="brutal-btn bg-ink text-white">RESET SESSION & RETURN HOME</button>
          </div>
        ) : (
          <div className="font-display text-4xl animate-pulse">CONNECTING...</div>
        )}
      </div>
    );
  }

  if (gameState.phase === 'lobby') {
    return <Lobby />;
  }

  const opponents = gameState.players.filter(p => p.id !== playerId);
  const isHost = gameState.hostId === playerId;

  let ariaActionText = "";
  if (gameState.lastAction) {
    const actor = gameState.players.find(p => p.id === gameState.lastAction?.playerId)?.name;
    if (gameState.lastAction.type === 'add') {
      ariaActionText = `${actor} played ${gameState.lastAction.details?.count || 0} cards.`;
    } else if (gameState.lastAction.type === 'challenge') {
      ariaActionText = `${actor} challenged!`;
    } else if (gameState.lastAction.type === 'skip') {
      ariaActionText = `${actor} skipped their turn.`;
    }
  }

  return (
    <div className="relative min-h-[100dvh] bg-paper flex flex-col items-center pt-14 font-sans overflow-hidden">
      
      <BrutalistStamp 
        show={!!lastChallengeResult} 
        text={lastChallengeResult?.wasBluff ? 'LIAR' : 'TRUTH'} 
        color={lastChallengeResult?.wasBluff ? 'red' : 'green'} 
      />
      <BrutalistStamp 
        show={lastBurned} 
        text="BURNED" 
        color="black" 
      />
      <div aria-live="polite" className="sr-only">
        {ariaActionText}
      </div>

      {(isReconnecting || connectionStatus === 'SYNCING') && (
        <div className="absolute top-0 left-0 right-0 bg-evidence-red text-white text-center py-1.5 z-50 font-bold border-b-2 border-ink flex items-center justify-center gap-2 shadow-[0_2px_0_#111111] text-xs">
          <span className="w-2 h-2 rounded-none bg-caution-yellow animate-ping"></span>
          {connectionStatus === 'SYNCING' ? 'SYNCING STATE...' : 'CONNECTION LOST. STAND BY.'}
        </div>
      )}

      {yourRole === 'winner_spectator' && gameState.phase === 'playing' && (
        <div className="absolute top-12 left-0 right-0 bg-confirmed-green text-white text-center py-1 z-40 font-mono text-xs font-bold uppercase">
          ★ EVIDENCE PURGED — SPECTATING
        </div>
      )}
      
      {/* Sleek Mobile-First Top Bar */}
      <div className="absolute top-3 left-3 right-3 flex justify-between items-center z-20 pointer-events-none">
        {/* Left: Compact Leave Icon Button */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button 
            onClick={handleLeaveGame}
            className="w-9 h-9 border-2 border-ink bg-white shadow-[2px_2px_0_#111111] flex items-center justify-center text-ink hover:bg-evidence-red hover:text-white active:translate-x-0.5 active:translate-y-0.5 transition-colors"
            title="Leave Game"
            aria-label="Leave Game"
          >
            <LogOut size={16} strokeWidth={2.5} />
          </button>
        </div>
        
        {/* Center: Claimed Rank Badge */}
        <div className="pointer-events-auto">
          {gameState.claimedRank ? (
            <div className="bg-caution-yellow border-2 border-ink shadow-[2px_2px_0_#111111] px-3.5 py-1 font-display text-sm sm:text-base uppercase tracking-tight flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-ink/70 font-bold">ROUND</span>
              <span className="font-black text-ink">{gameState.claimedRank}s</span>
            </div>
          ) : (
            <div className="bg-white border-2 border-ink shadow-[2px_2px_0_#111111] px-2.5 py-1 font-mono text-[10px] sm:text-xs font-bold uppercase text-ink/80">
              FRESH ROUND
            </div>
          )}
        </div>

        {/* Right: Audio Icon Controls (Mic & Speaker) */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            onClick={toggleMic}
            className={`w-9 h-9 border-2 border-ink shadow-[2px_2px_0_#111111] flex items-center justify-center transition-colors active:translate-x-0.5 active:translate-y-0.5 ${
              !voiceOn || micMuted 
                ? 'bg-white text-neutral-500 hover:bg-neutral-100' 
                : 'bg-confirmed-green text-white'
            }`}
            title={!voiceOn ? "Join Voice" : micMuted ? "Unmute Mic" : "Mute Mic"}
            aria-label="Toggle Microphone"
          >
            {!voiceOn || micMuted ? <MicOff size={16} strokeWidth={2.5} /> : <Mic size={16} strokeWidth={2.5} />}
          </button>

          <button
            onClick={toggleSpeaker}
            className={`w-9 h-9 border-2 border-ink shadow-[2px_2px_0_#111111] flex items-center justify-center transition-colors active:translate-x-0.5 active:translate-y-0.5 ${
              speakerMuted || !voiceOn 
                ? 'bg-white text-neutral-500 hover:bg-neutral-100' 
                : 'bg-caution-yellow text-ink'
            }`}
            title={speakerMuted ? "Unmute Speaker" : "Mute Speaker"}
            aria-label="Toggle Speaker"
          >
            {speakerMuted || !voiceOn ? <VolumeX size={16} strokeWidth={2.5} /> : <Volume2 size={16} strokeWidth={2.5} />}
          </button>
        </div>
      </div>

      {/* Opponents Table */}
      <div className="relative w-full max-w-sm sm:max-w-md mt-4 h-36 sm:h-44 flex justify-center items-center pointer-events-none">
        {opponents.map((p, i) => (
          <PlayerSeat key={p.id} player={p} position={i} total={opponents.length} />
        ))}
      </div>

      {/* Central Stack */}
      <div className="mt-2 mb-28 relative z-0 flex flex-col items-center">
        <Stack />
        {gameState.lastAction && (
          <div className="absolute -bottom-12 w-72 text-center pointer-events-none">
            <span className="bg-white border-2 border-ink shadow-[2px_2px_0_#111111] px-3 py-1 font-mono text-xs font-bold inline-block">
              <span className="text-evidence-red uppercase mr-1.5">
                {gameState.players.find(p => p.id === gameState.lastAction?.playerId)?.name}
              </span>
              {gameState.lastAction.type === 'add' ? `played ${gameState.lastAction.details?.count || 0}` : 
               gameState.lastAction.type === 'challenge' ? 'called bluff!' : 'skipped'}
            </span>
          </div>
        )}
      </div>

      {/* Hand & Actions */}
      <ActionBar selectedCards={selectedCards} clearSelection={() => setSelectedCards([])} />
      <Hand selectedCards={selectedCards} onSelect={toggleSelect} />

      {/* Game Verdict Modal with Rematch / Return to Lobby Support */}
      {gameState.phase === 'finished' && (
        <div className="absolute inset-0 bg-ink/90 z-50 flex flex-col items-center justify-center p-4 text-center backdrop-blur-sm">
          <h2 className="text-5xl sm:text-6xl font-display text-caution-yellow mb-2 tracking-tighter uppercase" style={{ textShadow: '4px 4px 0 #C1272D' }}>
            VERDICT
          </h2>
          <p className="font-mono text-white/80 text-xs sm:text-sm font-bold uppercase mb-4 tracking-widest">
            CASE CONCLUDED
          </p>

          <div className="bg-white border-4 border-ink shadow-[6px_6px_0_#111111] p-5 mb-6 w-full max-w-sm transform -rotate-1">
            <div className="border-b-2 border-ink/20 pb-2 mb-3">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-ink/70">
                OFFICIAL WINNERS
              </span>
            </div>
            <div className="space-y-2">
              {(gameState.winners && gameState.winners.length > 0
                ? gameState.winners
                : gameState.players.filter(p => p.isWinner).map(p => p.id)
              ).map((id, i) => (
                <div key={id} className="flex items-center justify-between border-2 border-ink p-2 bg-caution-yellow/20">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-evidence-red">#{i + 1}</span>
                    <span className="font-mono font-bold uppercase text-ink">
                      {gameState.players.find(p => p.id === id)?.name || id}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-confirmed-green text-white px-2 py-0.5 border border-ink">
                    SURVIVOR
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-xs">
            {isHost ? (
              <button
                onClick={resetToLobby}
                className="w-full brutal-btn bg-confirmed-green text-white text-base sm:text-lg py-3.5 flex items-center justify-center gap-2 hover:brightness-105"
              >
                <RotateCcw size={18} strokeWidth={2.5} />
                <span>PLAY AGAIN (LOBBY)</span>
              </button>
            ) : (
              <div className="border-2 border-dashed border-white/50 p-3 bg-white/10 text-center">
                <span className="font-mono text-xs text-caution-yellow font-bold uppercase animate-pulse">
                  Waiting for host to restart match...
                </span>
              </div>
            )}

            <button
              onClick={handleLeaveGame}
              className="w-full brutal-btn bg-white text-ink text-sm sm:text-base py-2.5"
            >
              EXIT TO HOME
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
