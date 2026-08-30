import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Bell, Gamepad2, LogIn, UserRound, X } from 'lucide-react';
import { useSession } from '../lib/auth';
import { getRoomInvites, respondToRoomInvite, type RoomInvite } from '../lib/profile';
import { ThemeToggle } from './ThemeToggle';
import { useGameStore } from '../state/gameStore';

type NavbarProps = {
  currentTab?: 'play' | 'friends' | 'profile';
};

export const Navbar: React.FC<NavbarProps> = ({ currentTab = 'play' }) => {
  const [location, setLocation] = useLocation();
  const { data: session } = useSession();
  const isRegistered = session?.user.isRegistered === true;
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [showInvites, setShowInvites] = useState(false);
  const { joinRoom } = useGameStore();
  const isHome = location === '/';
  const isProfileSurface = currentTab === 'profile' || currentTab === 'friends' || location.startsWith('/profile') || location.startsWith('/players/');

  useEffect(() => {
    if (!isRegistered) return;
    let active = true;
    const refresh = () => {
      getRoomInvites().then((data) => {
        if (active) setInvites(data.invites);
      }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
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

  return (
    <header className="app-nav page-container mb-3 border-b-2 border-ink/15 pb-3 sm:mb-6 sm:pb-4">
      <nav className="flex min-w-0 items-center gap-2" aria-label="Primary navigation">
        {isRegistered ? (
          isHome ? (
            <button
              type="button"
              onClick={() => setLocation('/profile')}
              className="icon-btn"
              aria-label="Open profile, friends, and stats"
              title="Profile, friends, and stats"
            >
              <UserRound size={19} strokeWidth={2.5} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setLocation('/')}
              className="icon-btn"
              aria-label="Return to play"
              title="Return to play"
              aria-current={isProfileSurface ? undefined : 'page'}
            >
              <Gamepad2 size={19} strokeWidth={2.5} />
            </button>
          )
        ) : isHome ? (
          <button
            type="button"
            onClick={() => setLocation('/auth')}
            className="brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 bg-caution-yellow text-xs text-ink"
          >
            <LogIn size={15} strokeWidth={2.5} />
            <span>Sign In</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setLocation('/')}
            className="icon-btn"
            aria-label="Return to play"
            title="Return to play"
          >
            <Gamepad2 size={19} strokeWidth={2.5} />
          </button>
        )}
      </nav>

      <div className="flex items-center gap-2">
        {isRegistered && (
          <button
            type="button"
            onClick={() => setShowInvites(true)}
            className="icon-btn relative border-2 bg-surface text-ink"
            aria-label={invites.length > 0 ? `${invites.length} room invitations` : 'Room invitations'}
            title="Room invitations"
          >
            <Bell size={18} strokeWidth={2.5} />
            {invites.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-ink bg-evidence-red px-1 font-mono text-[9px] font-bold text-white">
                {invites.length}
              </span>
            )}
          </button>
        )}
        <ThemeToggle />
      </div>

      {showInvites && (
        <div className="nav-invites-overlay fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={(event) => { if (event.target === event.currentTarget) setShowInvites(false); }}>
          <section className="nav-invites-dialog brutal-card w-full max-w-sm p-5 shadow-[6px_6px_0_var(--color-ink)]" aria-label="Room invitations">
            <div className="flex items-center justify-between border-b-2 border-ink pb-2">
              <h2 className="font-display text-xl uppercase">Live Invites</h2>
              <button type="button" className="icon-btn h-11 w-11" onClick={() => setShowInvites(false)} aria-label="Close invitations"><X size={16} /></button>
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
