import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { LogIn, LogOut, Shield, Sparkles, User, Users } from 'lucide-react';
import { signOut, useSession } from '../lib/auth';
import { getFriendships } from '../lib/profile';
import { ThemeToggle } from './ThemeToggle';

type NavbarProps = {
  currentTab?: 'play' | 'friends' | 'profile';
};

export const Navbar: React.FC<NavbarProps> = ({ currentTab = 'play' }) => {
  const [location, setLocation] = useLocation();
  const { data: session } = useSession();
  const isRegistered = session?.user.isRegistered === true;
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  useEffect(() => {
    if (!isRegistered) {
      setPendingRequestsCount(0);
      return;
    }
    let mounted = true;
    getFriendships()
      .then((data) => {
        if (!mounted) return;
        const incoming = data.friendships.filter((f) => f.direction === 'incoming').length;
        setPendingRequestsCount(incoming);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [isRegistered, location]);

  const handleSignOut = async () => {
    await signOut();
    setLocation('/');
  };

  return (
    <header className="page-container mb-6 flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink/15 pb-4 sm:mb-8">
      {/* Brand Monogram */}
      <button
        type="button"
        onClick={() => setLocation('/')}
        className="flex items-center gap-2.5 text-left transition-transform active:scale-[0.98]"
      >
        <span className="flex h-9 w-9 items-center justify-center border-2 border-ink bg-evidence-red font-display text-sm text-white shadow-[2px_2px_0_var(--color-ink)]">
          CJ
        </span>
        <div>
          <span className="block font-display text-base tracking-tight text-ink sm:text-lg">
            CHAL JHOOTHA
          </span>
          <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted">
            REAL-TIME BLUFF
          </span>
        </div>
      </button>

      {/* Main Navigation Links */}
      <nav className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => setLocation('/')}
          className={`brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 text-xs ${
            currentTab === 'play' && location === '/'
              ? 'bg-ink text-paper'
              : 'bg-surface text-ink'
          }`}
        >
          <Sparkles size={14} strokeWidth={2.5} />
          <span>Play</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (isRegistered) {
              setLocation('/profile?tab=friends');
            } else {
              setLocation('/auth');
            }
          }}
          className={`brutal-btn brutal-btn-compact relative inline-flex items-center gap-1.5 text-xs ${
            currentTab === 'friends' || location.includes('tab=friends')
              ? 'bg-ink text-paper'
              : 'bg-surface text-ink'
          }`}
          title={isRegistered ? 'View Friends' : 'Sign in to access Friends'}
        >
          <Users size={14} strokeWidth={2.5} />
          <span>Friends</span>
          {pendingRequestsCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center border border-ink bg-evidence-red px-1 font-mono text-[9px] font-bold text-white">
              {pendingRequestsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            if (isRegistered) {
              setLocation('/profile');
            } else {
              setLocation('/auth');
            }
          }}
          className={`brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 text-xs ${
            currentTab === 'profile' || (location.startsWith('/profile') && !location.includes('tab=friends')) || location.startsWith('/players/')
              ? 'bg-ink text-paper'
              : 'bg-surface text-ink'
          }`}
          title={isRegistered ? 'View Profile & Stats' : 'Sign in for Profile & Stats'}
        >
          <User size={14} strokeWidth={2.5} />
          <span className="hidden sm:inline">Profile</span>
          <span className="sm:hidden">Stats</span>
        </button>
      </nav>

      {/* User Actions & Theme Toggle */}
      <div className="flex items-center gap-2">
        {isRegistered ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLocation('/profile')}
              className="hidden items-center gap-1.5 border-2 border-ink bg-surface px-2.5 py-1.5 font-mono text-xs font-bold text-ink shadow-[2px_2px_0_var(--color-ink)] transition-transform active:scale-[0.98] md:flex"
              title="Your handle"
            >
              <Shield size={13} className="text-confirmed-green" strokeWidth={2.5} />
              <span>@{session?.user?.handle || session?.user?.name}</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="icon-btn border-2 bg-evidence-red text-white"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLocation('/auth')}
            className="brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 bg-caution-yellow text-xs text-ink"
          >
            <LogIn size={15} strokeWidth={2.5} />
            <span>Sign In</span>
          </button>
        )}

        <ThemeToggle />
      </div>
    </header>
  );
};
