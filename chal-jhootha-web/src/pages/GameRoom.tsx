import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { Card as PlayingCard, GameState } from 'shared';
import { LogOut, Mic, MicOff, Radio, RotateCcw, UserPlus, Users, Volume2, VolumeX } from 'lucide-react';
import { useLocation, useParams } from 'wouter';
import { useSession } from '../lib/auth';
import { createFriendRequest } from '../lib/profile';
import { ActionBar } from '../components/ActionBar';
import { BrutalistStamp } from '../components/BrutalistStamp';
import { CardFlightLayer, type CardFlight, type FlightPoint } from '../components/CardFlightLayer';
import { Hand } from '../components/Hand';
import { Lobby } from '../components/Lobby';
import { PlayerRosterSheet } from '../components/PlayerRosterSheet';
import { PlayerSeat } from '../components/PlayerSeat';
import { Stack } from '../components/Stack';
import { useGameStore } from '../state/gameStore';
import { RoomVoice } from '../voice/voice';

interface AnimationSnapshot {
  phase: GameState['phase'];
  stackCount: number;
  hand: PlayingCard[];
}

interface PendingPickup {
	playerId: string;
	count: number;
}

interface TableReaction {
  id: string;
  playerName: string;
  emoji: string;
}

const REACTIONS = ['🔥', '😂', '😮', '👏', '🃏', '👀', '😈', '💀'];

const flightPointFor = (rect: DOMRect, scale = 1): FlightPoint => {
  const isMobile = window.innerWidth < 640;
  const cardWidth = isMobile ? 72 : 96;
  const cardHeight = isMobile ? 112 : 144;
  return {
    x: rect.left + rect.width / 2 - cardWidth / 2,
    y: rect.top + rect.height / 2 - cardHeight / 2,
    scale,
  };
};

interface ActiveVoiceControlsProps {
  playerId: string | null;
  sendVoice: (kind: string, payload?: unknown, targetUserId?: string) => void;
  onVoiceError: (message: string) => void;
}

const ActiveVoiceControls: React.FC<ActiveVoiceControlsProps> = ({ playerId, sendVoice, onVoiceError }) => {
  const [voiceOn, setVoiceOn] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const voiceRef = useRef<RoomVoice | null>(null);

  useEffect(() => {
    if (!playerId) return;
    const voice = new RoomVoice(playerId, sendVoice);
    voiceRef.current = voice;
    return () => {
      voice.dispose();
      if (voiceRef.current === voice) voiceRef.current = null;
    };
  }, [playerId, sendVoice]);

  const enableVoice = async () => {
    const voice = voiceRef.current;
    if (!voice) {
      onVoiceError('Voice is not ready yet. Try again in a moment.');
      return;
    }
    onVoiceError('');
    try {
      await voice.join();
      voice.setMuted(false);
      voice.setSpeakerMuted(speakerMuted);
      setVoiceOn(true);
      setMicMuted(false);
    } catch {
      setVoiceOn(false);
      setMicMuted(true);
      onVoiceError('Microphone access was blocked. Allow microphone access in your browser settings, then try again.');
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

  return (
    <>
      <button type="button" onClick={toggleMic} className={`icon-btn ${voiceOn && !micMuted ? 'bg-confirmed-green text-white' : 'bg-surface text-ink-muted'}`} aria-label={!voiceOn ? 'Join voice chat' : micMuted ? 'Unmute microphone' : 'Mute microphone'} title={!voiceOn ? 'Join voice chat' : micMuted ? 'Unmute microphone' : 'Mute microphone'}>{!voiceOn || micMuted ? <MicOff size={19} strokeWidth={2.5} /> : <Mic size={19} strokeWidth={2.5} />}</button>
      <button type="button" onClick={toggleSpeaker} className={`icon-btn ${voiceOn && !speakerMuted ? 'bg-caution-yellow text-ink' : 'bg-surface text-ink-muted'}`} aria-label={speakerMuted ? 'Unmute speakers' : 'Mute speakers'} title={speakerMuted ? 'Unmute speakers' : 'Mute speakers'}>{speakerMuted || !voiceOn ? <VolumeX size={19} strokeWidth={2.5} /> : <Volume2 size={19} strokeWidth={2.5} />}</button>
    </>
  );
};

const DisabledVoiceControls: React.FC = () => (
  <>
    <button type="button" disabled className="icon-btn bg-surface text-ink-muted disabled:cursor-not-allowed disabled:opacity-45" aria-label="Voice chat unavailable for rooms over eight players" title="Voice chat is disabled above eight players"><MicOff size={19} strokeWidth={2.5} /></button>
    <button type="button" disabled className="icon-btn bg-surface text-ink-muted disabled:cursor-not-allowed disabled:opacity-45" aria-label="Voice chat unavailable for rooms over eight players" title="Voice chat is disabled above eight players"><VolumeX size={19} strokeWidth={2.5} /></button>
  </>
);

export const GameRoom: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const {
    gameState, isConnected, connectionStatus, playerId, roomCode, joinRoom, leaveRoom, resetSession, resetToLobby,
    lastError, lastChallengeResult, lastBurned, sendVoice, sendReaction, yourRole, handsCount, myHand,
  } = useGameStore();
  const { data: session } = useSession();
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [pendingName, setPendingName] = useState('');
  const [joinedName, setJoinedName] = useState<string | null>(null);
  const [connectionTimeout, setConnectionTimeout] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [reactions, setReactions] = useState<TableReaction[]>([]);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [flights, setFlights] = useState<CardFlight[]>([]);
  const [concealedCardIds, setConcealedCardIds] = useState<string[]>([]);
  const hasAttemptedJoin = useRef(false);
  const animationSnapshotRef = useRef<AnimationSnapshot | null>(null);
  const pendingPickupRef = useRef<PendingPickup | null>(null);
  const processedChallengeSeqsRef = useRef(new Set<number>());
  const flightSequenceRef = useRef(0);
  const reduceMotion = useReducedMotion();

  const storedToken = typeof window !== 'undefined' ? sessionStorage.getItem('rejoinToken') : null;
  const storedRoom = typeof window !== 'undefined' ? sessionStorage.getItem('roomCode') : null;
  const hasValidSession = (storedRoom === code && !!storedToken) || !!session?.user?.name || !!joinedName;
  const needsName = !hasValidSession && !gameState;
  const isReconnecting = connectionStatus === 'RECONNECTING' || connectionStatus === 'OFFLINE';

  useEffect(() => {
    const onReaction = (event: Event) => {
      const reaction = (event as CustomEvent<TableReaction>).detail;
      if (!reaction?.id || !reaction.emoji) return;
      setReactions((current) => current.some((item) => item.id === reaction.id) ? current : [...current, reaction]);
      window.setTimeout(() => setReactions((current) => current.filter((item) => item.id !== reaction.id)), 1800);
    };
    window.addEventListener('cj-reaction', onReaction as EventListener);
    return () => window.removeEventListener('cj-reaction', onReaction as EventListener);
  }, []);

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
    if (hasAttemptedJoin.current && !roomCode && !gameState) {
      setLocation('/');
    }
  }, [gameState, roomCode, setLocation]);

  const finishFlight = useCallback((flight: CardFlight) => {
    setFlights((current) => current.filter((candidate) => candidate.id !== flight.id));
    if (flight.revealCardId) {
      setConcealedCardIds((current) => current.filter((cardId) => cardId !== flight.revealCardId));
    }
  }, []);

  const queueFlights = useCallback((kind: 'deal' | 'pickup', targetPlayerId: string, count: number, revealCardIds: string[]) => {
    if (count <= 0) return;

    window.requestAnimationFrame(() => {
      const sourceElement = document.querySelector<HTMLElement>('[data-card-stack-anchor]');
      const handAnchor = document.querySelector<HTMLElement>('[data-hand-anchor]');
      const seat = Array.from(document.querySelectorAll<HTMLElement>('[data-player-seat-id]'))
        .find((element) => element.dataset.playerSeatId === targetPlayerId);
      const extraPlayersAnchor = document.querySelector<HTMLElement>('[data-extra-players-anchor]');
      const playerAnchor = targetPlayerId === playerId ? handAnchor : seat ?? extraPlayersAnchor;
      const sourceRect = sourceElement?.getBoundingClientRect();
      const fallbackTargetRect = playerAnchor?.getBoundingClientRect();

      if (!sourceRect || !fallbackTargetRect) {
        if (revealCardIds.length > 0) {
          setConcealedCardIds((current) => current.filter((cardId) => !revealCardIds.includes(cardId)));
        }
        return;
      }

      const source = flightPointFor(sourceRect, 0.92);
      const flightGroup = Array.from({ length: count }, (_, index) => {
        const revealCardId = revealCardIds[index];
        const handCard = revealCardId
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-hand-card-id]'))
              .find((element) => element.dataset.handCardId === revealCardId)
          : null;
        const targetRect = handCard?.getBoundingClientRect() ?? fallbackTargetRect;
        const isHandDestination = targetPlayerId === playerId;
        const targetScale = isHandDestination
          ? 1
          : Math.max(0.34, Math.min(0.58, targetRect.width / (window.innerWidth < 640 ? 72 : 96)));

        return {
          id: `${kind}-${flightSequenceRef.current}-${index}`,
          source,
          target: flightPointFor(targetRect, targetScale),
          delay: index * 0.04,
          revealCardId,
        } satisfies CardFlight;
      });

      flightSequenceRef.current += 1;
      setFlights((current) => [...current, ...flightGroup]);
    });
  }, [playerId]);

  useLayoutEffect(() => {
    if (!gameState) {
      animationSnapshotRef.current = null;
      pendingPickupRef.current = null;
      return;
    }

    const previous = animationSnapshotRef.current;
    const currentSnapshot: AnimationSnapshot = {
      phase: gameState.phase,
      stackCount: gameState.stackCount,
      hand: myHand,
    };

    const startsRound = previous?.phase === 'lobby' && gameState.phase === 'playing';
    if (startsRound && !reduceMotion) {
      gameState.players.forEach((player) => {
        const revealCardIds = player.id === playerId ? myHand.map((card) => card.id) : [];
        const cardCount = player.id === playerId ? revealCardIds.length : handsCount[player.id] ?? player.handCount;
        if (revealCardIds.length > 0) {
          setConcealedCardIds((current) => Array.from(new Set([...current, ...revealCardIds])));
        }
        queueFlights('deal', player.id, cardCount, revealCardIds);
      });
    }

    if (lastChallengeResult && !processedChallengeSeqsRef.current.has(lastChallengeResult.seq)) {
      processedChallengeSeqsRef.current.add(lastChallengeResult.seq);
      pendingPickupRef.current = {
        playerId: lastChallengeResult.pickedUpBy,
        count: previous?.stackCount ?? gameState.stackCount,
      };
    }

    const pendingPickup = pendingPickupRef.current;
    if (pendingPickup && gameState.stackCount === 0) {
      const priorHandIds = new Set(previous?.hand.map((card) => card.id) ?? []);
      const revealCardIds = pendingPickup.playerId === playerId
        ? myHand.filter((card) => !priorHandIds.has(card.id)).map((card) => card.id)
        : [];

      if (!reduceMotion && pendingPickup.count > 0) {
        if (revealCardIds.length > 0) {
          setConcealedCardIds((current) => Array.from(new Set([...current, ...revealCardIds])));
        }
        queueFlights('pickup', pendingPickup.playerId, pendingPickup.count, revealCardIds);
      }
      pendingPickupRef.current = null;
    }

    animationSnapshotRef.current = currentSnapshot;
  }, [gameState, handsCount, lastChallengeResult, myHand, playerId, queueFlights, reduceMotion]);

  const handleManualJoin = (event: React.FormEvent) => {
    event.preventDefault();
    if (!pendingName.trim()) return;
    setJoinedName(pendingName.trim().toUpperCase());
  };

  const currentSelectedCards = gameState?.phase === 'playing'
    ? selectedCards.filter((id) => myHand.some((card) => card.id === id))
    : [];

  const toggleSelect = (id: string) => {
    if (gameState?.phase !== 'playing' || !myHand.some((card) => card.id === id)) return;
    setSelectedCards((cards) => {
      const current = cards.filter((cardId) => myHand.some((card) => card.id === cardId));
      return current.includes(id) ? current.filter((cardId) => cardId !== id) : [...current, id];
    });
  };

  const voiceUnavailable = !!gameState && gameState.players.length > 8;

  const handleLeaveGame = () => {
    leaveRoom();
  };

  const sendTableReaction = (emoji: string) => {
    if (isConnected) sendReaction(emoji);
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
      <CardFlightLayer flights={flights} onFlightComplete={finishFlight} />
      <BrutalistStamp show={!!lastChallengeResult} text={lastChallengeResult?.wasBluff ? 'LIAR' : 'TRUTH'} color={lastChallengeResult?.wasBluff ? 'red' : 'green'} />
      <BrutalistStamp show={lastBurned} text="BURNED" color="black" />
      <p aria-live="polite" className="sr-only">{actionDescription}</p>
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[32%] z-40 mx-auto h-36 max-w-xl" aria-label="Table reactions">
        {reactions.map((reaction, index) => (
          <div key={reaction.id} className="table-reaction" style={{ left: `${18 + ((index * 19) % 62)}%`, animationDelay: `${(index % 3) * 45}ms` }}>
            <span>{reaction.emoji}</span><small>{reaction.playerName}</small>
          </div>
        ))}
      </div>

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
          {voiceUnavailable ? <DisabledVoiceControls /> : <ActiveVoiceControls key={playerId ?? 'pending'} playerId={playerId} sendVoice={sendVoice} onVoiceError={setVoiceError} />}
        </div>
      </header>

      {/* ── Status banners ── */}
      {(isReconnecting || connectionStatus === 'SYNCING') ? <p role="status" className="border-b-2 border-ink bg-evidence-red px-3 py-2 text-center font-mono text-xs font-bold uppercase text-white">{connectionStatus === 'SYNCING' ? 'Syncing room state' : 'Connection lost. Reconnecting.'}</p> : null}
      {yourRole === 'winner_spectator' ? <p className="border-b-2 border-ink bg-confirmed-green px-3 py-2 text-center font-mono text-xs font-bold uppercase text-white">You finished this match. Spectator mode is on.</p> : null}
      {voiceUnavailable ? <p role="status" className="border-b-2 border-ink bg-surface-muted px-3 py-2 text-center font-mono text-xs font-bold uppercase text-ink-muted">Voice chat is disabled for rooms with more than 8 players.</p> : null}

      {/* ── Open table play area ── */}
      <main className="table-area relative flex-1 w-full flex flex-col items-center justify-center min-h-[17rem] sm:min-h-[22rem] px-2 py-4 overflow-hidden select-none">
        <div className="table-stage relative w-full max-w-2xl h-[17rem] sm:h-[20rem] md:h-[22rem] flex items-center justify-center">
          {/* Centered played-card pile */}
          <div className="z-10 flex flex-col items-center">
            <Stack />
          </div>

          {/* Player seats arranged around the central stack */}
          {tableOpponents.map((player, index) => (
            <PlayerSeat key={player.id} player={player} position={index} total={tableOpponents.length} />
          ))}

          {additionalPlayers > 0 ? (
            <button
              type="button"
              data-extra-players-anchor
              onClick={() => setRosterOpen(true)}
              className="absolute bottom-2 right-2 border-2 border-ink bg-caution-yellow px-2 py-1 font-mono text-xs font-bold shadow-[2px_2px_0_var(--color-ink)] transition-transform active:translate-x-0.5 active:translate-y-0.5"
            >
              +{additionalPlayers} more
            </button>
          ) : null}
        </div>

        {voiceError && !voiceUnavailable ? (
          <p role="alert" className="mt-2 max-w-lg border-2 border-ink bg-evidence-red p-2.5 text-center font-mono text-xs font-bold leading-5 text-white">
            {voiceError}
          </p>
        ) : null}

        <div className="mt-3 flex max-w-full flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Send a table reaction">
          {REACTIONS.map((emoji) => <button key={emoji} type="button" onClick={() => sendTableReaction(emoji)} className="reaction-button" aria-label={`Send ${emoji} reaction`}>{emoji}</button>)}
        </div>
      </main>

      {/* ── Bottom action/hand region ── */}
      <div className="bottom-bar">
        <div className="mx-auto w-full max-w-2xl">
          <ActionBar selectedCards={currentSelectedCards} clearSelection={() => setSelectedCards([])} />
        </div>
        <Hand selectedCards={currentSelectedCards} onSelect={toggleSelect} concealedCardIds={concealedCardIds} />
      </div>

      <PlayerRosterSheet open={rosterOpen} onClose={() => setRosterOpen(false)} players={gameState.players} playerId={playerId} hostId={gameState.hostId} handsCount={handsCount} />

      {/* ── Verdict overlay ── */}
      {gameState.phase === 'finished' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/70 p-4 pt-[max(1rem,env(safe-area-inset-top))] text-center backdrop-blur-sm">
          <section className="my-auto w-full max-w-md border-3 border-ink bg-surface p-5 shadow-[6px_6px_0_var(--color-ink)] sm:p-6">
            <span className="inline-block border border-ink bg-evidence-red px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white">
              MATCH CONCLUDED
            </span>
            <h2 className="mt-2 font-display text-[clamp(2.5rem,12vw,4.5rem)] leading-none uppercase text-caution-yellow">
              Verdict
            </h2>

            <div className="mt-5 space-y-2 text-left">
              {gameState.players.map((player) => {
                const isWin = player.isWinner || (gameState.winners?.includes(player.id));
                const isYou = player.id === playerId;
                const canAdd = session?.user?.isRegistered && player.userId && player.userId !== session?.user?.id;

                return (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between gap-3 border-2 border-ink p-3 shadow-[2px_2px_0_var(--color-ink)] ${
                      isWin ? 'bg-caution-yellow/20' : 'bg-paper'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-mono text-sm font-bold uppercase">{player.name}</p>
                        {isYou && (
                          <span className="border border-ink bg-caution-yellow px-1 font-mono text-[9px] font-bold">
                            YOU
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-ink-muted">
                        {isWin ? '🏆 Victorious' : 'Eliminated'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isWin && (
                        <span className="border border-ink bg-confirmed-green px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-white">
                          Winner
                        </span>
                      )}
                      {canAdd && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await createFriendRequest(player.userId!);
                              alert(`Friend request sent to ${player.name}!`);
                            } catch {
                              alert(`Could not send friend request.`);
                            }
                          }}
                          className="brutal-btn brutal-btn-compact text-[10px] bg-surface text-ink hover:bg-caution-yellow"
                          title="Add Friend"
                        >
                          <UserPlus size={12} className="inline mr-1" />
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 grid gap-2.5">
              {isHost ? (
                <button
                  type="button"
                  onClick={resetToLobby}
                  className="brutal-btn flex items-center justify-center gap-2 bg-confirmed-green text-white"
                >
                  <RotateCcw size={17} strokeWidth={2.5} />
                  <span>Play Again</span>
                </button>
              ) : (
                <p className="border-2 border-ink bg-paper p-3 font-mono text-xs font-bold leading-5">
                  Waiting for the host to start a new match...
                </p>
              )}
              <button
                type="button"
                onClick={handleLeaveGame}
                className="brutal-btn bg-surface text-ink"
              >
                Return to Lobby
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};
