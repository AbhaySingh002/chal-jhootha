import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Bell, LogIn, LogOut, Shield, Sparkles, User, Users, X } from 'lucide-react';
import { signOut, useSession } from '../lib/auth';
import { getFriendships, getRoomInvites, respondToRoomInvite, type RoomInvite } from '../lib/profile';
import { ThemeToggle } from './ThemeToggle';
import { useGameStore } from '../state/gameStore';

type NavbarProps = {
  currentTab?: 'play' | 'friends' | 'profile';
};

export const Navbar: React.FC<NavbarProps> = ({ currentTab = 'play' }) => {
  const [location, setLocation] = useLocation();
  const { data: session } = useSession();
  const isRegistered = session?.user.isRegistered === true;
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [showInvites, setShowInvites] = useState(false);
  const { joinRoom } = useGameStore();

  useEffect(() => {
    if (!isRegistered) return;
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

  useEffect(() => {
    if (!isRegistered) {
      return;
    }
    let active = true;
    const refresh = () => {
      getRoomInvites().then((data) => {
        if (active) setInvites(data.invites);
      }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isRegistered]);

  const respondToInvite = async (invite: RoomInvite, accept: boolean) => {
    try {
      const result = await respondToRoomInvite(invite.token, accept);
      setInvites((current) => current.filter((item) => item.token !== invite.token));
      if (accept && result.roomCode) {
        setShowInvites(false);
        await joinRoom(result.roomCode, session?.user.name || '');
        setLocation(`/room/${result.roomCode}`);
      }
    } catch {
      setInvites((current) => current.filter((item) => item.token !== invite.token));
    }
  };

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
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-ink bg-evidence-red font-display text-sm text-white shadow-[2px_2px_0_var(--color-ink)]">
          CJ
        </span>
        <div>
          <span className="block font-display text-base tracking-tight text-ink sm:text-lg">
            CHAL JHOOTHA
          </span>
          <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
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

        {isRegistered && (
          <>
            <button
              type="button"
              onClick={() => setLocation('/profile?tab=friends')}
              className={`brutal-btn brutal-btn-compact relative inline-flex items-center gap-1.5 text-xs ${
                currentTab === 'friends' || location.includes('tab=friends')
                  ? 'bg-ink text-paper'
                  : 'bg-surface text-ink'
              }`}
              title="View Friends"
            >
              <Users size={14} strokeWidth={2.5} />
              <span>Friends</span>
              {pendingRequestsCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full border border-ink bg-evidence-red px-1 font-mono text-[9px] font-bold text-white">
                  {pendingRequestsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setLocation('/profile')}
              className={`brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 text-xs ${
                currentTab === 'profile' || (location.startsWith('/profile') && !location.includes('tab=friends')) || location.startsWith('/players/')
                  ? 'bg-ink text-paper'
                  : 'bg-surface text-ink'
              }`}
              title="View Profile & Stats"
            >
              <User size={14} strokeWidth={2.5} />
              <span className="hidden sm:inline">Profile</span>
              <span className="sm:hidden">Stats</span>
            </button>
          </>
        )}
      </nav>

      {/* User Actions & Theme Toggle */}
      <div className="flex items-center gap-2">
        {isRegistered ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLocation('/profile')}
              className="hidden items-center gap-1.5 rounded-lg border-2 border-ink bg-surface px-2.5 py-1.5 font-mono text-xs font-bold text-ink shadow-[2px_2px_0_var(--color-ink)] transition-transform active:scale-[0.98] md:flex"
              title="Your handle"
            >
              <Shield size={13} className="text-confirmed-green" strokeWidth={2.5} />
              <span>@{session?.user?.handle || session?.user?.name}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowInvites(true)}
              className="icon-btn relative border-2 bg-surface text-ink"
              aria-label="Room invitations"
              title="Room invitations"
            >
              <Bell size={16} strokeWidth={2.5} />
              {invites.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-ink bg-evidence-red px-1 font-mono text-[9px] font-bold text-white">{invites.length}</span>}
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

      {showInvites && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={(event) => { if (event.target === event.currentTarget) setShowInvites(false); }}>
          <section className="brutal-card w-full max-w-sm p-5 shadow-[6px_6px_0_var(--color-ink)]" aria-label="Room invitations">
            <div className="flex items-center justify-between border-b-2 border-ink pb-2">
              <h2 className="font-display text-xl uppercase">Live Invites</h2>
              <button type="button" className="icon-btn h-8 w-8" onClick={() => setShowInvites(false)} aria-label="Close invitations"><X size={16} /></button>
            </div>
            {invites.length === 0 ? <p className="py-6 text-center font-mono text-xs text-ink-muted">No active room invites.</p> : (
              <ul className="mt-4 space-y-3">
                {invites.map((invite) => (
                  <li key={invite.token} className="border-2 border-ink bg-paper p-3 font-mono text-xs">
                    <p><strong>{invite.hostName}</strong> invited you to room <strong>{invite.roomCode}</strong>.</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" className="brutal-btn brutal-btn-compact flex-1 bg-confirmed-green text-white" onClick={() => void respondToInvite(invite, true)}>Accept</button>
                      <button type="button" className="brutal-btn brutal-btn-compact flex-1 bg-surface text-ink" onClick={() => void respondToInvite(invite, false)}>Decline</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </header>
  );
};
