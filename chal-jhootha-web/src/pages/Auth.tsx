import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { login, register } from '../lib/auth';

export const Auth: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, name, handle);
      }
      setLocation('/');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-paper relative z-10">
      
      <div className="absolute top-4 left-4">
        <button onClick={() => setLocation('/')} className="brutal-btn py-2 px-4 bg-white">BACK</button>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-6xl font-display font-black text-ink mb-2 uppercase tracking-tighter">{isLogin ? 'LOGIN' : 'REGISTER'}</h1>
      </div>

      <div className="brutal-card p-8 max-w-sm w-full">
        {error && (
          <div className="mb-6 p-4 bg-evidence-red text-white font-bold uppercase text-sm brutal-shadow-sm brutal-border">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-ink mb-2">Display Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full brutal-input"
                  maxLength={16}
                  required={!isLogin}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-ink mb-2">Handle</label>
                <input
                  type="text"
                  value={handle}
                  onChange={e => setHandle(e.target.value.toLowerCase())}
                  className="w-full brutal-input"
                  placeholder="e.g. card_shark"
                  minLength={3}
                  maxLength={16}
                  pattern="[a-z0-9_]{3,16}"
                  required={!isLogin}
                />
                <p className="mt-1 font-mono text-[10px] text-ink/55">3–16 lowercase letters, digits, or underscores.</p>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-ink mb-2">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full brutal-input"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-ink mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full brutal-input"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full brutal-btn bg-confirmed-green text-white"
          >
            {isLogin ? 'AUTHENTICATE' : 'CREATE ACCOUNT'}
          </button>
        </form>

        <div className="mt-6 text-center border-t-2 border-ink pt-6">
          <button 
            type="button" 
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm font-bold uppercase tracking-widest text-ink hover:underline"
          >
            {isLogin ? 'NEED AN ACCOUNT? REGISTER' : 'ALREADY HAVE AN ACCOUNT? LOGIN'}
          </button>
        </div>
      </div>
    </div>
  );
};
