import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, UserPlus } from 'lucide-react';
import { useLocation } from 'wouter';
import { login, register } from '../lib/auth';
import { PageHeader } from '../components/PageHeader';

export const Auth: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [, setLocation] = useLocation();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      if (isLogin) await login(email, password);
      else await register(email, password, name, handle);
      setLocation('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed. Check your details and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader title={isLogin ? 'Account access' : 'Create account'} />
      <main id="main-content" className="page-container grid max-w-5xl items-start gap-8 pb-8 md:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] md:gap-12 md:pt-6">
        <section className="md:pt-8">
          <p className="inline-block border-2 border-ink bg-caution-yellow px-2 py-1 font-mono text-xs font-bold uppercase tracking-[0.14em]">Registered players</p>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,12vw,5.5rem)] leading-[0.86] uppercase tracking-[-0.06em]">
            {isLogin ? 'Back on the case' : 'Get your record'}
          </h1>
          <p className="mt-5 max-w-md font-mono text-sm leading-6 text-ink-muted sm:text-base">
            Keep your player profile, match record, friends, and recent opponents in one place.
          </p>
        </section>

        <section className="brutal-card p-4 sm:p-6" aria-labelledby="auth-form-title">
          <div className="mb-5 flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
            <div>
              <h2 id="auth-form-title" className="font-display text-2xl uppercase">{isLogin ? 'Sign in' : 'Register'}</h2>
              <p className="mt-1 font-mono text-xs text-ink-muted">{isLogin ? 'Use your email and password.' : 'Choose a public handle other players can find.'}</p>
            </div>
            {isLogin ? <KeyRound className="shrink-0 text-evidence-red" size={24} strokeWidth={2.5} /> : <UserPlus className="shrink-0 text-confirmed-green" size={24} strokeWidth={2.5} />}
          </div>

          {error ? <p role="alert" aria-live="assertive" className="mb-5 border-2 border-ink bg-evidence-red p-3 font-mono text-xs font-bold leading-5 text-white">{error}</p> : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin ? (
              <>
                <div>
                  <label htmlFor="display-name" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Display name</label>
                  <input id="display-name" type="text" value={name} onChange={(event) => setName(event.target.value)} className="brutal-input" maxLength={16} autoComplete="name" required />
                </div>
                <div>
                  <label htmlFor="handle" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Handle</label>
                  <input id="handle" type="text" value={handle} onChange={(event) => setHandle(event.target.value.toLowerCase())} className="brutal-input" placeholder="card_shark" minLength={3} maxLength={16} pattern="[a-z0-9_]{3,16}" autoComplete="username" required />
                  <p className="mt-2 font-mono text-xs leading-5 text-ink-muted">3-16 lowercase letters, digits, or underscores.</p>
                </div>
              </>
            ) : null}

            <div>
              <label htmlFor="email" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Email address</label>
              <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="brutal-input" autoComplete="email" inputMode="email" required />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Password</label>
              <div className="relative">
                <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="brutal-input pr-14" autoComplete={isLogin ? 'current-password' : 'new-password'} required />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-ink" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={20} strokeWidth={2.5} /> : <Eye size={20} strokeWidth={2.5} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={isSubmitting} className="brutal-btn mt-2 w-full bg-confirmed-green text-white">
              {isSubmitting ? 'Working' : isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="mt-6 border-t-2 border-ink pt-5">
            <button type="button" onClick={() => { setIsLogin((value) => !value); setError(''); }} className="font-mono text-sm font-bold underline underline-offset-4">
              {isLogin ? 'Need an account? Register' : 'Already registered? Sign in'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};
