import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Crown, Layers, Lock, Radio, Trophy, Users, WifiOff } from 'lucide-react';
import { useLocation } from 'wouter';
import { useGameStore } from '../state/gameStore';
import { ThemeToggle } from './ThemeToggle';

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

  useEffect(() => {
    if (!winnerCountLocked && isHost && playerCount >= 2 && currentWinnerCount > maxWinners) {
      setConfig(currentDeckCount, maxWinners);
    }
  }, [winnerCountLocked, isHost, playerCount, currentWinnerCount, maxWinners, currentDeckCount, setConfig]);

  if (!gameState || gameState.phase !== 'lobby') return null;

  const inviteUrl = `${window.location.origin}/room/${gameState.roomCode}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this room link', inviteUrl);
    }
  };

  const handleLeaveLobby = () => {
    resetSession();
    setLocation('/');
  };

  return (
    <div className="page-shell">
      <header className="page-container mb-7 flex items-center justify-between gap-3">
        <button type="button" onClick={handleLeaveLobby} className="brutal-btn brutal-btn-compact inline-flex items-center gap-2 bg-surface text-ink">
          <ArrowLeft size={17} strokeWidth={2.5} />
          <span>Leave</span>
        </button>
        <div className="min-w-0 text-center"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Room code</p><p className="font-display text-xl tracking-[0.08em]">{gameState.roomCode}</p></div>
        <ThemeToggle />
      </header>

      <main className="page-container grid items-start gap-6 pb-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <section className="brutal-card overflow-hidden">
          <div className="border-b-[3px] border-ink bg-ink p-4 text-paper sm:p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-caution-yellow">Private case file</p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <div><h1 className="font-display text-3xl uppercase sm:text-4xl">Lobby</h1><p className="mt-1 font-mono text-sm text-paper/75">Invite your crew, then let the host start the match.</p></div>
              <button type="button" onClick={() => void copyLink()} className="brutal-btn brutal-btn-compact inline-flex items-center gap-2 bg-caution-yellow text-ink">
                {copied ? <Check size={17} strokeWidth={2.5} /> : <Copy size={17} strokeWidth={2.5} />}
                {copied ? 'Copied' : 'Copy invite'}
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink pb-3">
              <div className="flex items-center gap-2"><Users size={20} strokeWidth={2.5} /><h2 className="font-display text-xl uppercase">{playerCount} seated</h2></div>
              <span className="border-2 border-ink bg-paper px-2 py-1 font-mono text-xs font-bold uppercase">{playerCount < 2 ? 'Need 2 players' : 'Ready to start'}</span>
            </div>

            <ul className="grid gap-2 sm:grid-cols-2">
              {gameState.players.map((player, index) => (
                <li key={player.id} className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-2 border-ink p-3 ${player.id === playerId ? 'bg-caution-yellow/25' : 'bg-paper'}`}>
                  <span className="font-display text-lg text-evidence-red">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0"><p className="truncate font-mono text-sm font-bold uppercase">{player.name}</p><p className="mt-1 font-mono text-[11px] text-ink-muted">{player.id === playerId ? 'You' : player.isDisconnected ? 'Away' : 'Connected'}</p></div>
                  <span className="flex items-center gap-1.5">{player.id === gameState.hostId ? <Crown size={18} className="text-caution-yellow" strokeWidth={2.5} aria-label="Host" /> : null}{player.isDisconnected ? <WifiOff size={18} className="text-evidence-red" strokeWidth={2.5} aria-label="Away" /> : null}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="brutal-card p-4 sm:p-5">
            <div className="flex items-start gap-3 border-b-2 border-ink pb-4"><Layers className="mt-0.5 text-evidence-red" size={22} strokeWidth={2.5} /><div><h2 className="font-display text-2xl uppercase">Match setup</h2><p className="mt-1 font-mono text-xs leading-5 text-ink-muted">{isHost ? 'Only the host can set the match.' : 'The host controls these settings.'}</p></div></div>

            {playerCount < 2 ? (
              <div className="mt-5 border-2 border-dashed border-ink bg-paper p-4"><div className="flex items-center gap-2 font-mono text-sm font-bold uppercase"><Radio size={18} className="text-evidence-red" strokeWidth={2.5} />Waiting for another player</div><p className="mt-2 font-mono text-xs leading-5 text-ink-muted">Share the invite link. Match controls unlock once two people are seated.</p><label htmlFor="invite-link" className="sr-only">Invite link</label><input id="invite-link" readOnly value={inviteUrl} onClick={(event) => event.currentTarget.select()} className="brutal-input mt-4 text-xs" /></div>
            ) : isHost ? (
              <div className="mt-5 space-y-4">
                <div><label htmlFor="deck-count" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Deck count</label><select id="deck-count" className="brutal-select" value={currentDeckCount} onChange={(event) => setConfig(Number(event.target.value), currentWinnerCount)}><option value={1}>1 deck - 52 cards</option><option value={2}>2 decks - 104 cards</option><option value={3}>3 decks - 156 cards</option></select></div>
                <div><div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="winner-count" className="font-mono text-xs font-bold uppercase tracking-[0.12em]">Target winners</label>{winnerCountLocked ? <span className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase text-confirmed-green"><Lock size={12} strokeWidth={2.5} />Locked</span> : <span className="font-mono text-[10px] font-bold text-ink-muted">1-{maxWinners}</span>}</div><select id="winner-count" className="brutal-select disabled:opacity-55" value={winnerCountLocked ? currentWinnerCount : Math.min(currentWinnerCount, maxWinners)} disabled={winnerCountLocked} onChange={(event) => setConfig(currentDeckCount, Number(event.target.value))}>{Array.from({ length: winnerCountLocked ? 1 : maxWinners }, (_, index) => winnerCountLocked ? currentWinnerCount : index + 1).map((winnerCount) => <option key={winnerCount} value={winnerCount}>{winnerCount === 1 ? '1 winner - first to empty' : `${winnerCount} winners - top ${winnerCount}`}</option>)}</select><p className="mt-2 font-mono text-xs leading-5 text-ink-muted">{winnerCountLocked ? 'This room keeps its target through every replay.' : 'The target locks when the first match begins.'}</p></div>
              </div>
            ) : (
              <div className="mt-5 grid gap-3"><div className="border-2 border-ink bg-paper p-3"><p className="font-mono text-xs font-bold uppercase text-ink-muted">Decks</p><p className="mt-1 font-display text-2xl">{currentDeckCount}</p></div><div className="border-2 border-ink bg-paper p-3"><p className="font-mono text-xs font-bold uppercase text-ink-muted">Target winners</p><p className="mt-1 flex items-center gap-2 font-display text-2xl">{currentWinnerCount}{winnerCountLocked ? <Lock size={17} className="text-confirmed-green" strokeWidth={2.5} /> : null}</p></div></div>
            )}
          </section>

          {isHost ? <button type="button" disabled={playerCount < 2} onClick={startGame} className="brutal-btn flex w-full items-center justify-center gap-2 bg-confirmed-green text-white"><Trophy size={20} strokeWidth={2.5} />{playerCount < 2 ? 'Waiting for players' : `Start match for ${playerCount}`}</button> : <div className="border-3 border-ink bg-caution-yellow p-4 font-mono text-sm font-bold leading-6">The host will start the match when everyone is ready.</div>}
        </aside>
      </main>
    </div>
  );
};
