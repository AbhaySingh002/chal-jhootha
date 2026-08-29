import React, { useEffect, useRef, useState } from 'react';
import { LogOut, Mic, MicOff, Radio, RotateCcw, Users, Volume2, VolumeX } from 'lucide-react';
import { useLocation, useParams } from 'wouter';
import { useSession } from '../lib/auth';
import { ActionBar } from '../components/ActionBar';
import { BrutalistStamp } from '../components/BrutalistStamp';
import { Hand } from '../components/Hand';
import { Lobby } from '../components/Lobby';
import { PlayerRosterSheet } from '../components/PlayerRosterSheet';
import { PlayerSeat } from '../components/PlayerSeat';
import { Stack } from '../components/Stack';
import { useGameStore } from '../state/gameStore';
import { RoomVoice } from '../voice/voice';

export const GameRoom: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const {
    gameState, isConnected, connectionStatus, playerId, roomCode, joinRoom, resetSession, resetToLobby,
    lastError, lastChallengeResult, lastBurned, sendVoice, yourRole, handsCount,
  } = useGameStore();
  const { data: session } = useSession();
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [pendingName, setPendingName] = useState('');
  const [joinedName, setJoinedName] = useState<string | null>(null);
  const [connectionTimeout, setConnectionTimeout] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [rosterOpen, setRosterOpen] = useState(false);
  const hasAttemptedJoin = useRef(false);
  const voiceRef = useRef<RoomVoice | null>(null);

  const storedToken = typeof window !== 'undefined' ? sessionStorage.getItem('rejoinToken') : null;
  const storedRoom = typeof window !== 'undefined' ? sessionStorage.getItem('roomCode') : null;
  const hasValidSession = (storedRoom === code && !!storedToken) || !!session?.user?.name || !!joinedName;
  const needsName = !hasValidSession && !gameState;
  const isReconnecting = connectionStatus === 'RECONNECTING' || connectionStatus === 'OFFLINE';

  useEffect(() => {
    if (!playerId) return;
    const voice = new RoomVoice(playerId, sendVoice);
    voiceRef.current = voice;
    return () => {
      voice.leave();
      if (voiceRef.current === voice) voiceRef.current = null;
    };
  }, [playerId, sendVoice]);

  useEffect(() => {
    if (!isConnected || gameState) return;
    const timer = window.setTimeout(() => setConnectionTimeout(true), 3000);
    return () => window.clearTimeout(timer);
  }, [isConnected, gameState]);

  useEffect(() => {
    if (!code || hasAttemptedJoin.current) return;
    if (isConnected && gameState && roomCode === code) {
      hasAttemptedJoin.current = true;
      return;
    }
    const savedRoom = sessionStorage.getItem('roomCode');
    const savedToken = sessionStorage.getItem('rejoinToken');
    if (savedRoom === code && savedToken) {
      hasAttemptedJoin.current = true;
      void joinRoom(code, session?.user?.name || 'REJOIN');
    } else if (session?.user?.name) {
      hasAttemptedJoin.current = true;
      void joinRoom(code, session.user.name);
    } else if (joinedName) {
      hasAttemptedJoin.current = true;
      void joinRoom(code, joinedName);
    }
  }, [code, roomCode, isConnected, gameState, session?.user?.name, joinRoom, joinedName]);

  useEffect(() => {
    if (!gameState) return;
    setSelectedCards((cards) => cards.filter((id) => gameState.phase === 'playing' && useGameStore.getState().myHand.some((card) => card.id === id)));
  }, [gameState?.phase, gameState?.roomCode]);

  const handleManualJoin = (event: React.FormEvent) => {
    event.preventDefault();
    if (!pendingName.trim()) return;
    setJoinedName(pendingName.trim().toUpperCase());
  };

  const toggleSelect = (id: string) => setSelectedCards((cards) => cards.includes(id) ? cards.filter((card) => card !== id) : [...cards, id]);

  const enableVoice = async () => {
    const voice = voiceRef.current;
    if (!voice) {
      setVoiceError('Voice is not ready yet. Try again in a moment.');
      return;
    }
    setVoiceError('');
    try {
      await voice.join();
      voice.setMuted(false);
      voice.setSpeakerMuted(speakerMuted);
      setVoiceOn(true);
      setMicMuted(false);
    } catch {
      setVoiceOn(false);
      setMicMuted(true);
      setVoiceError('Microphone access was blocked. Allow microphone access in your browser settings, then try again.');
    }
  };

  const toggleMic = () => {
    if (!voiceOn) {
      void enableVoice();
      return;
    }
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    voiceRef.current?.setMuted(nextMuted);
  };

  const toggleSpeaker = () => {
    if (!voiceOn) {
      void enableVoice();
      return;
    }
    const nextMuted = !speakerMuted;
    setSpeakerMuted(nextMuted);
    voiceRef.current?.setSpeakerMuted(nextMuted);
  };

  const handleLeaveGame = () => {
    voiceRef.current?.leave();
    resetSession();
    setLocation('/');
  };

  /* ── Pre-game states ── */

  if (lastError && !gameState) {
    return (
      <div className="page-shell flex items-center justify-center">
        <section className="brutal-card w-full max-w-md p-5 text-center">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-evidence-red">Room unavailable</p>
          <h1 className="mt-3 font-display text-3xl uppercase">Unable to join</h1>
          <p role="alert" aria-live="assertive" className="mt-4 font-mono text-sm leading-6 text-ink-muted">{lastError}</p>
          <button type="button" onClick={() => setLocation('/')} className="brutal-btn mt-6 w-full bg-caution-yellow text-ink">Return home</button>
        </section>
      </div>
    );
  }

  if (needsName) {
    return (
      <div className="page-shell flex items-center justify-center">
        <section className="brutal-card w-full max-w-md p-5 sm:p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-evidence-red">Private room</p>
          <h1 className="mt-3 font-display text-3xl uppercase">Join this case</h1>
          <p className="mt-2 font-mono text-sm leading-6 text-ink-muted">Enter an alias before taking your seat.</p>
          <form onSubmit={handleManualJoin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="room-alias" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Alias</label>
              <input id="room-alias" type="text" maxLength={10} placeholder="YOUR NAME" value={pendingName} onChange={(event) => setPendingName(event.target.value.toUpperCase())} className="brutal-input text-center uppercase" autoComplete="nickname" autoFocus />
            </div>
            <button type="submit" disabled={!pendingName.trim()} className="brutal-btn w-full bg-caution-yellow text-ink">Join room</button>
          </form>
        </section>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="page-shell flex items-center justify-center">
        <section className="w-full max-w-md text-center">
          {connectionTimeout ? (
            <>
              <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-evidence-red">Connection timeout</p>
              <h1 className="mt-3 font-display text-3xl uppercase">No room state</h1>
              <p className="mt-3 font-mono text-sm leading-6 text-ink-muted">The server connected but did not send the room state. Reset and try the invite again.</p>
              <button type="button" onClick={() => { resetSession(); setLocation('/'); }} className="brutal-btn mt-6 bg-caution-yellow text-ink">Reset session</button>
            </>
          ) : (
            <>
              <Radio className="mx-auto animate-pulse text-evidence-red" size={32} strokeWidth={2.5} />
              <p className="mt-4 font-display text-3xl uppercase">Connecting</p>
              <p className="mt-2 font-mono text-sm text-ink-muted">Getting your room state.</p>
            </>
          )}
        </section>
      </div>
    );
  }

  if (gameState.phase === 'lobby') return <Lobby />;

  /* ── Live game layout ── */

  const opponents = gameState.players.filter((player) => player.id !== playerId);
  const tableOpponents = opponents.slice(0, 5);
  const additionalPlayers = opponents.length - tableOpponents.length;
  const isHost = gameState.hostId === playerId;
  let actionDescription = '';
  if (gameState.lastAction) {
    const actor = gameState.players.find((player) => player.id === gameState.lastAction?.playerId)?.name || 'A player';
    actionDescription = gameState.lastAction.type === 'add' ? `${actor} played ${gameState.lastAction.details?.count || 0} cards.` : gameState.lastAction.type === 'challenge' ? `${actor} called bluff.` : `${actor} skipped.`;
  }

  return (
    <div className="game-shell">
      <BrutalistStamp show={!!lastChallengeResult} text={lastChallengeResult?.wasBluff ? 'LIAR' : 'TRUTH'} color={lastChallengeResult?.wasBluff ? 'red' : 'green'} />
      <BrutalistStamp show={lastBurned} text="BURNED" color="black" />
      <p aria-live="polite" className="sr-only">{actionDescription}</p>

      {/* ── Sticky top bar ── */}
      <header className="game-topbar">
        <button type="button" onClick={handleLeaveGame} className="icon-btn" aria-label="Leave room" title="Leave room"><LogOut size={19} strokeWidth={2.5} /></button>
        <div className="min-w-0 text-center">
          {gameState.claimedRank
            ? <p className="truncate font-display text-base uppercase sm:text-lg">Claiming <span className="text-evidence-red">{gameState.claimedRank}s</span></p>
            : <p className="truncate font-display text-base uppercase sm:text-lg">Fresh round</p>
          }
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">{gameState.stackCount} cards on stack</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={() => setRosterOpen(true)} className="icon-btn" aria-label="Show all players" title="Show all players"><Users size={19} strokeWidth={2.5} /></button>
          <button type="button" onClick={toggleMic} className={`icon-btn ${voiceOn && !micMuted ? 'bg-confirmed-green text-white' : 'bg-surface text-ink-muted'}`} aria-label={!voiceOn ? 'Join voice chat' : micMuted ? 'Unmute microphone' : 'Mute microphone'} title={!voiceOn ? 'Join voice chat' : micMuted ? 'Unmute microphone' : 'Mute microphone'}>{!voiceOn || micMuted ? <MicOff size={19} strokeWidth={2.5} /> : <Mic size={19} strokeWidth={2.5} />}</button>
          <button type="button" onClick={toggleSpeaker} className={`icon-btn ${voiceOn && !speakerMuted ? 'bg-caution-yellow text-ink' : 'bg-surface text-ink-muted'}`} aria-label={speakerMuted ? 'Unmute speakers' : 'Mute speakers'} title={speakerMuted ? 'Unmute speakers' : 'Mute speakers'}>{speakerMuted || !voiceOn ? <VolumeX size={19} strokeWidth={2.5} /> : <Volume2 size={19} strokeWidth={2.5} />}</button>
        </div>
      </header>

      {/* ── Status banners ── */}
      {(isReconnecting || connectionStatus === 'SYNCING') ? <p role="status" className="border-b-2 border-ink bg-evidence-red px-3 py-2 text-center font-mono text-xs font-bold uppercase text-white">{connectionStatus === 'SYNCING' ? 'Syncing room state' : 'Connection lost. Reconnecting.'}</p> : null}
      {yourRole === 'winner_spectator' ? <p className="border-b-2 border-ink bg-confirmed-green px-3 py-2 text-center font-mono text-xs font-bold uppercase text-white">You finished this match. Spectator mode is on.</p> : null}

      {/* ── Flexible table area ── */}
      <main className="table-area">
        <section
          className="relative w-full border-[3px] border-ink bg-surface-muted shadow-[5px_5px_0_var(--color-ink)]"
          style={{ maxWidth: 'min(100%, 28rem)', height: 'clamp(10rem, 28vw, 13rem)' }}
          aria-label="Game table"
        >
          <div className="absolute inset-x-[18%] bottom-5 top-12 border-2 border-ink bg-paper" />
          {tableOpponents.map((player, index) => <PlayerSeat key={player.id} player={player} position={index} total={tableOpponents.length} />)}
          {additionalPlayers > 0 ? <button type="button" onClick={() => setRosterOpen(true)} className="absolute bottom-3 left-1/2 -translate-x-1/2 border-2 border-ink bg-caution-yellow px-2 py-1 font-mono text-xs font-bold shadow-[2px_2px_0_var(--color-ink)]">+{additionalPlayers} more players</button> : null}
        </section>

        <div className="mt-8 flex flex-col items-center sm:mt-10">
          <Stack />
          {gameState.lastAction ? (
            <p className="mt-5 max-w-xs border-2 border-ink bg-surface px-3 py-2 text-center font-mono text-xs font-bold leading-5">
              <span className="text-evidence-red">{gameState.players.find((player) => player.id === gameState.lastAction?.playerId)?.name}</span>{' '}
              {gameState.lastAction.type === 'add' ? `played ${gameState.lastAction.details?.count || 0} cards` : gameState.lastAction.type === 'challenge' ? 'called bluff' : 'skipped'}
            </p>
          ) : null}
        </div>
        {voiceError ? <p role="alert" className="mt-5 max-w-lg border-2 border-ink bg-evidence-red p-3 text-center font-mono text-xs font-bold leading-5 text-white">{voiceError}</p> : null}
      </main>

      {/* ── Bottom action/hand region ── */}
      <div className="bottom-bar">
        <div className="mx-auto w-full max-w-2xl">
          <ActionBar selectedCards={selectedCards} clearSelection={() => setSelectedCards([])} />
        </div>
        <Hand selectedCards={selectedCards} onSelect={toggleSelect} />
      </div>

      <PlayerRosterSheet open={rosterOpen} onClose={() => setRosterOpen(false)} players={gameState.players} playerId={playerId} hostId={gameState.hostId} handsCount={handsCount} />

      {/* ── Verdict overlay ── */}
      {gameState.phase === 'finished' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/70 p-4 pt-[max(1rem,env(safe-area-inset-top))] text-center backdrop-blur-sm">
          <section className="my-auto w-full max-w-md border-3 border-ink bg-surface p-4 shadow-[6px_6px_0_var(--color-ink)] sm:p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-evidence-red">Case concluded</p>
            <h2 className="mt-2 font-display text-[clamp(3rem,14vw,5rem)] leading-[0.82] uppercase text-caution-yellow">Verdict</h2>
            <div className="mt-6 space-y-2 text-left">
              {(gameState.winners?.length ? gameState.winners : gameState.players.filter((player) => player.isWinner).map((player) => player.id)).map((id, index) => (
                <div key={id} className="flex items-center justify-between gap-3 border-2 border-ink bg-paper p-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-evidence-red">#{index + 1}</p>
                    <p className="truncate font-mono font-bold uppercase">{gameState.players.find((player) => player.id === id)?.name || id}</p>
                  </div>
                  <span className="border border-ink bg-confirmed-green px-2 py-1 font-mono text-[10px] font-bold uppercase text-white">Winner</span>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-3">
              {isHost ? (
                <button type="button" onClick={resetToLobby} className="brutal-btn flex items-center justify-center gap-2 bg-confirmed-green text-white"><RotateCcw size={19} strokeWidth={2.5} />Play again</button>
              ) : (
                <p className="border-2 border-ink bg-paper p-3 font-mono text-xs font-bold leading-5">Waiting for the host to return everyone to the lobby.</p>
              )}
              <button type="button" onClick={handleLeaveGame} className="brutal-btn bg-surface text-ink">Exit to home</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};
