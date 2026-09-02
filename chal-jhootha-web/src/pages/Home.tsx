import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, Plus, Shield, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSession } from '../lib/auth';
import { useGameStore } from '../state/gameStore';
import { connectSocket, disconnectSocket } from '../ws/socket';
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
    if (!isRegistered) {
      disconnectSocket();
    } else {
      void connectSocket();
    }
    resetSession();
  }, [resetSession, isRegistered]);

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
    return guestName.trim();
  };

  const handleCreate = () => {
    setCreateError(null);
    setIsCreating(true);
    const nameToUse = resolvePlayerName();
    if (!nameToUse) {
      setCreateError('Enter a player alias to create a room.');
      setIsCreating(false);
      return;
    }
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
    if (!nameToUse) {
      setCreateError('Enter a player alias to join a room.');
      return;
    }
    void joinRoom(cleanCode, nameToUse);
    setLocation(`/room/${cleanCode}`);
  };

  return (
    <div className="page-shell home-shell">
      <Navbar currentTab="play" />

      <main id="main-content" className="home-main page-container grid items-start gap-6 pb-12 lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,28rem)] xl:grid-cols-[minmax(0,1.4fr)_minmax(24rem,30rem)] lg:gap-12 xl:gap-16 lg:pt-6 xl:pt-10 max-w-7xl">
        {/* Left Hero Section */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="home-hero min-w-0 pt-2 lg:pt-6"
        >
          <h1 className="home-title font-display text-[clamp(2.5rem,8.5vw,5.5rem)] leading-[0.88] tracking-[-0.05em] text-ink">
            <span className="hero-wordmark">
              <span aria-hidden="true" className="hero-dealer">
                <svg className="hero-card-vector hero-card-vector--back" viewBox="0 0 34 48" focusable="false" aria-hidden="true">
                  {/* Shadow */}
                  <rect x="2" y="2" width="30" height="44" rx="3.5" fill="var(--color-ink)" />
                  {/* Surface */}
                  <rect x="0" y="0" width="30" height="44" rx="3.5" fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth="2" />
                  {/* Red Ornate Margin Frame */}
                  <rect x="2.5" y="2.5" width="25" height="39" rx="2" fill="none" stroke="var(--color-evidence-red)" strokeWidth="0.75" strokeDasharray="2 1" />
                  {/* Corner Pips & Indices */}
                  <path d="M5.5 5.5l1.5 2-1.5 2-1.5-2z M24.5 5.5l1.5 2-1.5 2-1.5-2z M5.5 38.5l1.5 2-1.5 2-1.5-2z M24.5 38.5l1.5 2-1.5 2-1.5-2z" fill="var(--color-evidence-red)" />
                  <text x="4.5" y="14" fontFamily="var(--font-display)" fontSize="5.5" fontWeight="900" fill="var(--color-evidence-red)" textAnchor="middle">K</text>
                  <g transform="rotate(180 25.5 33)">
                    <text x="25.5" y="35" fontFamily="var(--font-display)" fontSize="5.5" fontWeight="900" fill="var(--color-evidence-red)" textAnchor="middle">K</text>
                  </g>
                  {/* Starburst Rays */}
                  <g stroke="var(--color-evidence-red)" strokeWidth="0.6" strokeOpacity="0.4" strokeLinecap="round">
                    <line x1="15" y1="9" x2="15" y2="13" />
                    <line x1="15" y1="31" x2="15" y2="35" />
                    <line x1="4" y1="22" x2="8" y2="22" />
                    <line x1="22" y1="22" x2="26" y2="22" />
                    <line x1="7" y1="14" x2="10" y2="17" />
                    <line x1="20" y1="27" x2="23" y2="30" />
                    <line x1="7" y1="30" x2="10" y2="27" />
                    <line x1="20" y1="17" x2="23" y2="14" />
                  </g>
                  {/* Center Diamond Emblem */}
                  <path d="M15 13l6.5 9-6.5 9-6.5-9z" fill="none" stroke="var(--color-evidence-red)" strokeWidth="1.25" />
                  <path d="M15 15l5 7-5 7-5-7z" fill="var(--color-evidence-red)" fillOpacity="0.15" stroke="var(--color-evidence-red)" strokeWidth="0.75" />
                  <path d="M15 17.5l3.2 4.5-3.2 4.5-3.2-4.5z" fill="var(--color-evidence-red)" />
                  <circle cx="15" cy="22" r="1" fill="var(--color-surface)" />
                </svg>
                <svg className="hero-card-vector hero-card-vector--front" viewBox="0 0 34 48" focusable="false" aria-hidden="true">
                  {/* Shadow */}
                  <rect x="2" y="2" width="30" height="44" rx="3.5" fill="var(--color-ink)" />
                  {/* Surface */}
                  <rect x="0" y="0" width="30" height="44" rx="3.5" fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth="2" />
                  {/* Micro Border & Corner Brackets */}
                  <rect x="2.5" y="2.5" width="25" height="39" rx="2" fill="none" stroke="var(--color-ink)" strokeWidth="0.5" strokeOpacity="0.25" />
                  <path d="M4 6.5h2.5 M4 6.5v2.5 M26 6.5h-2.5 M26 6.5v2.5 M4 37.5h2.5 M4 37.5v-2.5 M26 37.5h-2.5 M26 37.5v-2.5" stroke="var(--color-ink)" strokeWidth="0.75" strokeLinecap="round" />
                  {/* Top-Left Corner Index */}
                  <text x="5" y="9.5" fontFamily="var(--font-display)" fontSize="6" fontWeight="900" fill="var(--color-ink)" textAnchor="middle">A</text>
                  <path d="M5 11c-.8 1.1-1.8 1.9-1.8 2.8 0 .8.6 1.3 1.3 1.3.4 0 .8-.2 1-.5.2.3.6.5 1 .5.7 0 1.3-.5 1.3-1.3 0-.9-1-1.7-1.8-2.8l-.5-.7z M4.6 14.8l-.3 1.4h1.4l-.3-1.4z" fill="var(--color-ink)" />
                  {/* Bottom-Right Corner Index */}
                  <g transform="rotate(180 25 36.5)">
                    <text x="25" y="34" fontFamily="var(--font-display)" fontSize="6" fontWeight="900" fill="var(--color-ink)" textAnchor="middle">A</text>
                    <path d="M25 35.5c-.8 1.1-1.8 1.9-1.8 2.8 0 .8.6 1.3 1.3 1.3.4 0 .8-.2 1-.5.2.3.6.5 1 .5.7 0 1.3-.5 1.3-1.3 0-.9-1-1.7-1.8-2.8l-.5-.7z M24.6 39.3l-.3 1.4h1.4l-.3-1.4z" fill="var(--color-ink)" />
                  </g>
                  {/* Radiating Accent Cross */}
                  <g stroke="var(--color-caution-yellow)" strokeWidth="1" strokeLinecap="round">
                    <line x1="15" y1="13" x2="15" y2="15" />
                    <line x1="15" y1="29" x2="15" y2="31" />
                    <line x1="6" y1="22" x2="8" y2="22" />
                    <line x1="22" y1="22" x2="24" y2="22" />
                  </g>
                  {/* Centerpiece Ace of Spades */}
                  <path d="M15 12c-3.8 4.2-6.5 6.8-6.5 10.5 0 2.8 2.1 4.8 4.8 4.8 1.3 0 2.5-.6 3.2-1.6l-1 4.3h3l-1-4.3c.7 1 1.9 1.6 3.2 1.6 2.7 0 4.8-2 4.8-4.8 0-3.7-2.7-6.3-6.5-10.5l-2-2.3z" fill="var(--color-ink)" />
                  <path d="M15 13.8c-2.8 3.5-4.8 5.6-4.8 8.7 0 1.9 1.4 3.3 3.3 3.3.9 0 1.8-.4 2.3-1.1L15 13.8z" fill="var(--color-surface)" fillOpacity="0.22" />
                  <path d="M15 19l2 3-2 3-2-3z" fill="var(--color-surface)" />
                  <circle cx="15" cy="22" r="0.75" fill="var(--color-evidence-red)" />
                </svg>
                <svg className="hero-dealer-pip" viewBox="0 0 18 22" focusable="false" aria-hidden="true">
                  <path d="M10 2l6.5 8-6.5 9-6.5-9z" fill="var(--color-ink)" />
                  <path d="M9 0l6.5 8-6.5 9-6.5-9z" fill="var(--color-evidence-red)" stroke="var(--color-ink)" strokeWidth="1.2" />
                  <path d="M9 1.5l-4.8 6.5L9 15.2V1.5z" fill="rgba(255,255,255,0.4)" />
                  <path d="M9 1.5v13.7l4.8-7.2L9 1.5z" fill="rgba(0,0,0,0.2)" />
                  <polygon points="9,5 10.5,8 9,11 7.5,8" fill="var(--color-caution-yellow)" />
                </svg>
              </span>
              <span className="hero-word">CHAL</span>
            </span><br />JHOOTHA
          </h1>

          <p className="home-description mt-4 max-w-md border-l-[3px] border-ink pl-3.5 font-mono text-sm font-semibold leading-relaxed text-ink-muted sm:text-base">
            Call bluffs, disguise plays, and empty your hand before you get caught.
          </p>

          <div className="home-badges mt-6 flex flex-wrap items-center gap-3 font-mono text-xs font-bold uppercase text-ink-muted">
            <div className="flex items-center gap-2 rounded-lg border border-ink/20 bg-surface px-3 py-1.5 shadow-[2px_2px_0_var(--color-ink)]">
              <Users size={15} className="text-evidence-red" strokeWidth={2.5} />
              <span>2+ PLAYERS</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-ink/20 bg-surface px-3 py-1.5 shadow-[2px_2px_0_var(--color-ink)]">
              <Shield size={15} className="text-confirmed-green" strokeWidth={2.5} />
              <span>VOICE & P2P SYNC</span>
            </div>
          </div>
        </motion.section>

        {/* Right Match Card */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="home-match brutal-card w-full p-5 sm:p-7"
          aria-labelledby="match-hub-title"
        >
          <div className="mb-5 flex items-start justify-between border-b-2 border-ink pb-3.5">
            <div>
              <h2 id="match-hub-title" className="font-display text-2xl uppercase tracking-tight sm:text-3xl">
                Match Hub
              </h2>
              <p className="mt-0.5 font-mono text-xs text-ink-muted">Create a private room or enter a code</p>
            </div>
            <div className="hidden lg:flex items-center gap-1.5 rounded-full border border-confirmed-green/30 bg-confirmed-green/10 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-confirmed-green animate-pulse" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-confirmed-green">Live Gateway</span>
            </div>
          </div>

          {/* Signed In Identity vs Guest Name */}
          {isRegistered ? (
            <div className="mb-5 flex items-center justify-between rounded-lg border-2 border-ink bg-paper p-3 shadow-[2px_2px_0_var(--color-ink)]">
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
                className="brutal-input text-center uppercase tracking-[0.15em] font-mono"
                autoComplete="nickname"
              />
            </div>
          )}

          {/* Create Room Button */}
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating || (!isRegistered && !guestName.trim())}
            className="brutal-btn flex w-full items-center justify-center gap-2 bg-confirmed-green lg:bg-ink lg:text-surface lg:hover:bg-ink/90 text-white transition-all active:scale-[0.98]"
          >
            {isCreating ? (
              <>
                <div className="h-2 w-2 animate-pulse rounded-full bg-current" />
                <span>Creating Room...</span>
              </>
            ) : (
              <>
                <Plus size={18} strokeWidth={2.5} />
                <span>Create Room</span>
              </>
            )}
          </button>

          {createError || lastError ? (
            <p role="alert" aria-live="assertive" className="mt-4 rounded-lg border-2 border-ink bg-evidence-red p-3 font-mono text-xs font-bold text-white">
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
                className="brutal-input text-center text-xl uppercase tracking-[0.3em] font-mono font-bold"
                maxLength={4}
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              disabled={code.trim().length !== 4 || (!isRegistered && !guestName.trim())}
              className="brutal-btn flex w-full items-center justify-center gap-2 bg-caution-yellow text-ink transition-all active:scale-[0.98]"
            >
              <span>Join Room</span>
              <ArrowRight size={16} strokeWidth={2.5} />
              <kbd className="hidden lg:inline-flex ml-1 px-1.5 py-0.5 text-[10px] font-mono font-normal rounded border border-ink/20 bg-surface/60 text-ink-muted">↵</kbd>
            </button>
          </form>
        </motion.section>
      </main>
    </div>
  );
};
