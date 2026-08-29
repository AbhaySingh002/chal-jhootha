import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGameStore } from '../state/gameStore';
import { useSession, signOut } from '../lib/auth';
import { User, LogOut } from 'lucide-react';
import { disconnectSocket } from '../ws/socket';

export const Home: React.FC = () => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { createRoom, joinRoom, roomCode, gameState, resetSession, lastError } = useGameStore();
  const { data: session } = useSession();

  // Clear stale session when landing on Home
  useEffect(() => {
    disconnectSocket();
    resetSession();
  }, [resetSession]);

  useEffect(() => {
    // Navigate only when gameState is confirmed from the server
    if (roomCode && gameState?.roomCode === roomCode) {
      setLocation(`/room/${roomCode}`);
    }
  }, [roomCode, gameState?.roomCode, setLocation]);

  const handleCreate = () => {
    setCreateError(null);
    setIsCreating(true);
    const playerName = session?.user?.name || name || `BHAI_${Math.floor(Math.random() * 100)}`;
    createRoom(playerName);
    
    setTimeout(() => {
      setIsCreating((currentlyCreating) => {
        if (currentlyCreating) {
          console.error('[Create Room] Timeout: No response from server after 8s.');
          setCreateError('Creation timed out. Please try again.');
          return false;
        }
        return currentlyCreating;
      });
    }, 8000);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    const playerName = session?.user?.name || name || `BHAI_${Math.floor(Math.random() * 100)}`;
    joinRoom(code.toUpperCase(), playerName);
    setLocation(`/room/${code.toUpperCase()}`);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4 bg-paper relative z-10 font-sans overflow-hidden">
      
      {/* Texture noise background */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-multiply" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}></div>

      {session?.user.isRegistered ? (
        <div className="absolute top-4 right-4 flex gap-4 brutal-border p-2 bg-white brutal-shadow-sm items-center">
          <span className="font-mono font-bold uppercase hidden md:inline">ID: {session.user.name}</span>
          <button onClick={() => setLocation('/profile')} className="p-2 hover:bg-caution-yellow transition-colors" aria-label="Profile">
            <User size={24} className="text-ink" strokeWidth={2.5} />
          </button>
          <button onClick={() => signOut()} className="p-2 hover:bg-evidence-red hover:text-white transition-colors border-l-2 border-ink pl-4" aria-label="Logout">
            <LogOut size={24} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <div className="absolute top-4 right-4">
          <button onClick={() => setLocation('/auth')} className="brutal-btn py-2 px-4 bg-white text-ink text-sm">LOGIN / REGISTER</button>
        </div>
      )}

      <div className="text-center mb-12 relative">
        <div className="absolute -top-12 -left-8 text-evidence-red opacity-80 transform -rotate-12 pointer-events-none">
          <span className="font-display text-4xl uppercase tracking-tighter">100%</span>
        </div>
        <h1 className="text-7xl md:text-9xl font-display font-black text-ink mb-2 tracking-tighter uppercase leading-[0.8]" style={{ textShadow: '6px 6px 0 #C1272D' }}>
          CHAL<br/>JHOOTHA
        </h1>
        <p className="font-mono text-ink/80 mt-6 font-bold uppercase tracking-widest text-sm md:text-base border-t-4 border-b-4 border-ink py-2 bg-white inline-block px-4 brutal-shadow-sm">
          Call The Bluff. Catch The Liar.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-8 relative z-10">
        <div className="brutal-card p-6 bg-white">
          {!session && (
            <div className="mb-6">
              <label className="block text-xs font-bold uppercase tracking-widest text-ink mb-2">Guest Alias</label>
              <input
                type="text"
                maxLength={10}
                placeholder="E.g. PLAYER1"
                value={name}
                onChange={e => setName(e.target.value.toUpperCase())}
                className="w-full brutal-input text-center text-xl uppercase placeholder:text-ink/30"
              />
            </div>
          )}

          <button 
            onClick={handleCreate}
            disabled={isCreating}
            className="w-full brutal-btn mb-2 bg-confirmed-green text-white disabled:opacity-50"
          >
            {isCreating ? 'CREATING ROOM...' : 'CREATE ROOM'}
          </button>
          
          {(createError || lastError) && (
            <div className="mb-6 p-2 bg-evidence-red text-white text-xs font-bold text-center brutal-border uppercase">
              {createError || lastError}
            </div>
          )}

          <div className="relative border-b-4 border-ink my-8">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-4 font-mono font-bold text-sm uppercase">OR</span>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-ink mb-2">Room Code</label>
              <input
                type="text"
                placeholder="ENTER CODE"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                className="w-full brutal-input text-center text-2xl uppercase tracking-widest placeholder:text-ink/30"
                maxLength={4}
              />
            </div>
            <button 
              type="submit"
              disabled={!code}
              className="w-full brutal-btn bg-caution-yellow text-ink disabled:bg-neutral-300 disabled:shadow-none"
            >
              JOIN ROOM
            </button>
          </form>
        </div>
      </div>
      
      <div className="absolute bottom-4 left-4 font-mono text-[10px] uppercase font-bold text-ink/50 tracking-widest">
        VER 1.0 // NO CHEATING
      </div>
    </div>
  );
};
