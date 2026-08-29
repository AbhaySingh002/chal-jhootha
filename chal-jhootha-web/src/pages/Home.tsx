import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Plus, Shield, Users } from 'lucide-react';
import { useSession } from '../lib/auth';
import { useGameStore } from '../state/gameStore';
import { disconnectSocket } from '../ws/socket';
import { Navbar } from '../components/Navbar';

export const Home: React.FC = () => {
  const [code, setCode] = useState('');
  const [guestName, setGuestName] = useState('');
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
    if (roomCode && gameState?.roomCode === roomCode) {
      setLocation(`/room/${roomCode}`);
    }
  }, [roomCode, gameState?.roomCode, setLocation]);

  useEffect(() => () => {
    if (createTimeout.current) window.clearTimeout(createTimeout.current);
  }, []);

  const resolvePlayerName = () => {
    if (isRegistered && session?.user?.name) {
      return session.user.name;
    }
    return guestName.trim() || `AGENT_${Math.floor(100 + Math.random() * 900)}`;
  };

  const handleCreate = () => {
    setCreateError(null);
    setIsCreating(true);
    const nameToUse = resolvePlayerName();
    void createRoom(nameToUse);
    createTimeout.current = window.setTimeout(() => {
      setIsCreating((creating) => {
        if (creating) {
          setCreateError('Connection timed out. Please try again.');
        }
        return false;
      });
    }, 8000);
  };

  const handleJoin = (event: React.FormEvent) => {
    event.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length !== 4) return;
    const nameToUse = resolvePlayerName();
    void joinRoom(cleanCode, nameToUse);
    setLocation(`/room/${cleanCode}`);
  };

  return (
    <div className="page-shell">
      <Navbar currentTab="play" />

      <main id="main-content" className="page-container grid items-start gap-6 pb-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,28rem)] lg:gap-12 lg:pt-4">
        {/* Left Hero Section */}
        <section className="min-w-0 pt-2 lg:pt-6">
          <div className="mb-3 inline-flex items-center gap-1.5 border-2 border-ink bg-evidence-red px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[2px_2px_0_var(--color-ink)]">
            <span>OFFICIAL BLUFF PROTOCOL</span>
          </div>

          <h1 className="font-display text-[clamp(2.5rem,9vw,5.75rem)] leading-[0.85] tracking-[-0.06em] text-ink">
            CHAL<br />JHOOTHA
          </h1>

          <p className="mt-4 max-w-md border-l-[3px] border-ink pl-3.5 font-mono text-sm font-semibold leading-relaxed text-ink-muted sm:text-base">
            Call bluffs, disguise plays, and empty your hand before you get caught.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4 font-mono text-xs font-bold uppercase text-ink-muted">
            <div className="flex items-center gap-2 border border-ink/20 bg-surface px-3 py-1.5 shadow-[2px_2px_0_var(--color-ink)]">
              <Users size={15} className="text-evidence-red" strokeWidth={2.5} />
              <span>2–8 PLAYERS</span>
            </div>
            <div className="flex items-center gap-2 border border-ink/20 bg-surface px-3 py-1.5 shadow-[2px_2px_0_var(--color-ink)]">
              <Shield size={15} className="text-confirmed-green" strokeWidth={2.5} />
              <span>VOICE & P2P SYNC</span>
            </div>
          </div>
        </section>

        {/* Right Match Card */}
        <section className="brutal-card w-full p-5 sm:p-7" aria-labelledby="match-hub-title">
          <div className="mb-5 border-b-2 border-ink pb-3.5">
            <h2 id="match-hub-title" className="font-display text-2xl uppercase tracking-tight sm:text-3xl">
              Match Hub
            </h2>
            <p className="mt-0.5 font-mono text-xs text-ink-muted">Create a private room or enter a code</p>
          </div>

          {/* Signed In Identity vs Guest Name */}
          {isRegistered ? (
            <div className="mb-5 flex items-center justify-between border-2 border-ink bg-paper p-3 shadow-[2px_2px_0_var(--color-ink)]">
              <div className="min-w-0">
                <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  PLAYING AS
                </span>
                <span className="truncate font-mono text-sm font-bold uppercase text-ink">
                  {session?.user?.name} <span className="text-ink-muted">(@{session?.user?.handle || 'agent'})</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLocation('/profile')}
                className="brutal-btn brutal-btn-compact text-xs bg-surface text-ink hover:bg-caution-yellow"
              >
                Stats
              </button>
            </div>
          ) : (
            <div className="mb-5">
              <label htmlFor="guest-alias" className="mb-1.5 block font-mono text-xs font-bold uppercase tracking-[0.1em]">
                Player Alias
              </label>
              <input
                id="guest-alias"
                type="text"
                maxLength={12}
                placeholder="YOUR NAME"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value.toUpperCase())}
                className="brutal-input text-center uppercase"
                autoComplete="nickname"
              />
            </div>
          )}

          {/* Create Room Button */}
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating}
            className="brutal-btn flex w-full items-center justify-center gap-2 bg-confirmed-green text-white transition-transform active:scale-[0.98]"
          >
            <Plus size={18} strokeWidth={2.5} />
            <span>{isCreating ? 'Creating Room...' : 'Create New Room'}</span>
          </button>

          {createError || lastError ? (
            <p role="alert" aria-live="assertive" className="mt-4 border-2 border-ink bg-evidence-red p-3 font-mono text-xs font-bold text-white">
              {createError || lastError}
            </p>
          ) : null}

          {/* Clean Divider */}
          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-[2px] flex-1 bg-ink/20" />
            <span className="font-mono text-xs font-bold text-ink-muted">OR JOIN</span>
            <span className="h-[2px] flex-1 bg-ink/20" />
          </div>

          {/* Join Room Form */}
          <form onSubmit={handleJoin} className="space-y-3">
            <div>
              <label htmlFor="room-code" className="mb-1.5 block font-mono text-xs font-bold uppercase tracking-[0.1em]">
                Room Code
              </label>
              <input
                id="room-code"
                type="text"
                inputMode="text"
                placeholder="ABCD"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                className="brutal-input text-center text-xl uppercase tracking-[0.3em]"
                maxLength={4}
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              disabled={code.trim().length !== 4}
              className="brutal-btn flex w-full items-center justify-center gap-2 bg-caution-yellow text-ink transition-transform active:scale-[0.98]"
            >
              <span>Join Room</span>
              <ArrowRight size={16} strokeWidth={2.5} />
            </button>
          </form>
        </section>
      </main>
    </div>
  );
};
