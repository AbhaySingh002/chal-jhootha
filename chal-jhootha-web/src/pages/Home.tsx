import React, { useEffect, useRef, useState } from 'react';
import { LogIn, LogOut, Plus, User, Users } from 'lucide-react';
import { useLocation } from 'wouter';
import { useSession, signOut } from '../lib/auth';
import { useGameStore } from '../state/gameStore';
import { disconnectSocket } from '../ws/socket';
import { ThemeToggle } from '../components/ThemeToggle';

export const Home: React.FC = () => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createTimeout = useRef<number | null>(null);
  const [, setLocation] = useLocation();
  const { createRoom, joinRoom, roomCode, gameState, resetSession, lastError } = useGameStore();
  const { data: session } = useSession();
  const isRegistered = session?.user.isRegistered === true;

  useEffect(() => {
    disconnectSocket();
    resetSession();
  }, [resetSession]);

  useEffect(() => {
    if (roomCode && gameState?.roomCode === roomCode) setLocation(`/room/${roomCode}`);
  }, [roomCode, gameState?.roomCode, setLocation]);

  useEffect(() => () => {
    if (createTimeout.current) window.clearTimeout(createTimeout.current);
  }, []);

  const playerName = () => session?.user?.name || name.trim() || `BHAI_${Math.floor(Math.random() * 100)}`;

  const handleCreate = () => {
    setCreateError(null);
    setIsCreating(true);
    void createRoom(playerName());
    createTimeout.current = window.setTimeout(() => {
      setIsCreating((creating) => {
        if (creating) setCreateError('Room creation timed out. Check your connection and try again.');
        return false;
      });
    }, 8000);
  };

  const handleJoin = (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    void joinRoom(code.trim().toUpperCase(), playerName());
    setLocation(`/room/${code.trim().toUpperCase()}`);
  };

  return (
    <div className="page-shell">
      <header className="page-container mb-6 flex items-center justify-between gap-3 sm:mb-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-ink-muted">Real-time card game</p>
        <div className="flex items-center gap-2">
          {isRegistered ? (
            <>
              <button type="button" onClick={() => setLocation('/profile')} className="icon-btn" aria-label="Open profile" title="Open profile">
                <User size={20} strokeWidth={2.5} />
              </button>
              <button type="button" onClick={() => void signOut()} className="icon-btn bg-evidence-red text-white" aria-label="Sign out" title="Sign out">
                <LogOut size={20} strokeWidth={2.5} />
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setLocation('/auth')} className="brutal-btn brutal-btn-compact inline-flex items-center gap-2 bg-surface text-ink">
              <LogIn size={17} strokeWidth={2.5} />
              <span>Account</span>
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main id="main-content" className="page-container grid items-start gap-6 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,30rem)] lg:gap-14 lg:pt-8">
        <section className="min-w-0 lg:pt-8">
          <p className="mb-3 inline-block border-2 border-ink bg-evidence-red px-2 py-1 font-mono text-xs font-bold uppercase tracking-[0.16em] text-white">Call the bluff</p>
          <h1 className="font-display text-[clamp(2.5rem,12vw,7.25rem)] leading-[0.82] tracking-[-0.075em] text-ink">
            CHAL<br />JHOOTHA
          </h1>
          <p className="mt-5 max-w-md border-l-[3px] border-ink pl-4 font-mono text-sm font-bold leading-6 text-ink-muted sm:mt-7 sm:text-base">
            Create a private room, deal the cards, and catch the liar before your hand runs out.
          </p>
          <div className="mt-5 flex items-center gap-3 font-mono text-xs font-bold uppercase text-ink-muted sm:mt-7">
            <Users size={18} strokeWidth={2.5} className="text-evidence-red" />
            <span>Bring your own suspects</span>
          </div>
        </section>

        <section className="brutal-card w-full p-4 sm:p-6" aria-labelledby="room-entry-title">
          <div className="mb-5 border-b-2 border-ink pb-4">
            <h2 id="room-entry-title" className="font-display text-2xl uppercase sm:text-3xl">Enter a room</h2>
            <p className="mt-1 font-mono text-sm text-ink-muted">Start a new case or join one with a four-character code.</p>
          </div>

          {!isRegistered ? (
            <div className="mb-5">
              <label htmlFor="guest-alias" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Guest alias</label>
              <input id="guest-alias" type="text" maxLength={10} placeholder="PLAYER NAME" value={name} onChange={(event) => setName(event.target.value.toUpperCase())} className="brutal-input text-center uppercase" autoComplete="nickname" />
              <p className="mt-2 font-mono text-xs text-ink-muted">Leave it blank for a quick guest name.</p>
            </div>
          ) : (
            <div className="mb-5 border-2 border-ink bg-paper p-3 font-mono text-sm">Playing as <strong className="uppercase">{session?.user.name}</strong></div>
          )}

          <button type="button" onClick={handleCreate} disabled={isCreating} className="brutal-btn flex w-full items-center justify-center gap-2 bg-confirmed-green text-white">
            <Plus size={20} strokeWidth={2.5} />
            <span>{isCreating ? 'Creating room' : 'Create room'}</span>
          </button>

          {createError || lastError ? <p role="alert" aria-live="assertive" className="mt-4 border-2 border-ink bg-evidence-red p-3 font-mono text-xs font-bold leading-5 text-white">{createError || lastError}</p> : null}

          <div className="my-6 flex items-center gap-3" aria-hidden="true"><span className="h-[2px] flex-1 bg-ink" /><span className="font-mono text-xs font-bold">OR</span><span className="h-[2px] flex-1 bg-ink" /></div>

          <form onSubmit={handleJoin} className="space-y-3">
            <div>
              <label htmlFor="room-code" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Room code</label>
              <input id="room-code" type="text" inputMode="text" placeholder="ABCD" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} className="brutal-input text-center text-xl uppercase tracking-[0.28em]" maxLength={4} autoComplete="off" />
            </div>
            <button type="submit" disabled={code.trim().length !== 4} className="brutal-btn w-full bg-caution-yellow text-ink">Join room</button>
          </form>
        </section>
      </main>
    </div>
  );
};
