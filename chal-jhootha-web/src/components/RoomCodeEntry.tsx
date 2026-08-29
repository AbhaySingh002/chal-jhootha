import React, { useState } from 'react';
import { useGameStore } from '../state/gameStore';

export const RoomCodeEntry: React.FC = () => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const { joinRoom, createRoom, lastError } = useGameStore();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-paper">
      <div className="text-center mb-8">
        <h1 className="text-6xl font-display font-black text-ink mb-2 uppercase tracking-tighter" style={{ textShadow: '4px 4px 0 #C1272D' }}>CHAL JHOOTHA</h1>
        <p className="text-ink font-mono font-bold tracking-widest uppercase text-xs">Call The Bluff. Catch The Liar.</p>
      </div>

      <div className="brutal-card p-6 max-w-sm w-full bg-white">
        {lastError && (
          <div className="mb-6 p-3 bg-evidence-red text-white text-xs font-bold text-center brutal-border uppercase">
            {lastError}
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-ink mb-2">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value.toUpperCase())}
              className="w-full brutal-input text-center text-lg uppercase"
              placeholder="E.G. SUSPECT_1"
              maxLength={10}
            />
          </div>

          <div className="pt-4 border-t-2 border-ink">
            <label className="block text-xs font-bold uppercase tracking-widest text-ink mb-2">Join Room</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                className="w-full brutal-input text-center text-xl uppercase tracking-widest"
                placeholder="CODE"
                maxLength={4}
              />
              <button
                disabled={!name || code.length < 4}
                onClick={() => joinRoom(code, name)}
                className="brutal-btn py-2 px-4 bg-caution-yellow text-ink text-base disabled:opacity-50 disabled:shadow-none"
              >
                JOIN
              </button>
            </div>
          </div>

          <div className="relative border-b-4 border-ink my-6">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-3 font-mono font-bold text-xs uppercase">OR</span>
          </div>

          <button
            disabled={!name}
            onClick={() => createRoom(name)}
            className="w-full brutal-btn bg-confirmed-green text-white text-base py-3 disabled:opacity-50 disabled:shadow-none"
          >
            CREATE NEW CASE
          </button>
        </div>
      </div>
    </div>
  );
};
