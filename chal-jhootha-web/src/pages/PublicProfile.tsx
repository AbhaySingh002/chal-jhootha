import React, { useEffect, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { Shield, UserCheck, UserPlus } from 'lucide-react';
import { useSession } from '../lib/auth';
import {
  getPublicProfile,
  calculateWinRate,
  useFriendRequest,
  type FriendshipState,
  type PlayerProfile,
} from '../lib/profile';
import { Navbar } from '../components/Navbar';

export const PublicProfile: React.FC = () => {
  const { handle } = useParams<{ handle: string }>();
  const [, setLocation] = useLocation();
  const { data: session, isPending } = useSession();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [friendshipState, setFriendshipState] = useState<FriendshipState>('none');
  const [error, setError] = useState('');
  const { requestFriend: sendFriendRequest, isRequesting, error: requestError, setError: setRequestError } = useFriendRequest();

  useEffect(() => {
    if (isPending || !handle) return;
    let active = true;
    void getPublicProfile(handle)
      .then((result) => {
        if (!active) return;
        setProfile(result.profile);
        setFriendshipState(result.friendshipState);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Player not found.');
      });
    return () => {
      active = false;
    };
  }, [isPending, handle]);

  const requestFriend = async () => {
    if (!profile) return;
    setRequestError('');
    await sendFriendRequest(profile.userId, () => {
      setFriendshipState('outgoing');
    });
  };

  if (isPending || (!profile && !error)) {
    return (
      <div className="page-shell">
        <Navbar currentTab="profile" />
        <main className="page-container max-w-2xl animate-pulse pt-6">
          <div className="h-64 border-3 border-ink bg-surface-muted shadow-[4px_4px_0_var(--color-ink)]" />
        </main>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="page-shell">
        <Navbar currentTab="profile" />
        <main className="page-container max-w-xl pb-12 pt-6">
          <section role="alert" className="brutal-card border-evidence-red p-6 text-center">
            <h1 className="font-display text-3xl uppercase text-evidence-red">Player Unavailable</h1>
            <p className="mt-2 font-mono text-sm text-ink-muted">{error || 'Player record not found.'}</p>
            <button
              type="button"
              onClick={() => setLocation('/profile?tab=find')}
              className="brutal-btn mt-5 bg-caution-yellow text-ink"
            >
              Search Another Player
            </button>
          </section>
        </main>
      </div>
    );
  }

  const rate = calculateWinRate(profile.gamesPlayed, profile.gamesWon);

  return (
    <div className="page-shell">
      <Navbar currentTab="profile" />

      <main id="main-content" className="page-container max-w-2xl pb-12 pt-2">
        <section className="brutal-card p-6 sm:p-8">
          <div className="mb-4 inline-flex items-center gap-1.5 border-2 border-ink bg-surface px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-ink shadow-[2px_2px_0_var(--color-ink)]">
            <Shield size={13} className="text-confirmed-green" strokeWidth={2.5} />
            <span>PLAYER DOSSIER</span>
          </div>

          <h1 className="break-words font-display text-[clamp(2.5rem,8vw,4.5rem)] leading-none tracking-tight">
            @{profile.handle}
          </h1>
          <p className="mt-2 font-mono text-sm font-bold uppercase text-ink-muted">
            {profile.displayName}
          </p>

          {/* Stats Bar */}
          <div className="mt-6 grid grid-cols-3 gap-3" aria-label="Player Statistics">
            <div className="border-2 border-ink bg-paper p-3 text-center shadow-[2px_2px_0_var(--color-ink)]">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                MATCHES
              </span>
              <p className="mt-1 font-display text-2xl sm:text-3xl">{profile.gamesPlayed}</p>
            </div>

            <div className="border-2 border-ink bg-caution-yellow p-3 text-center shadow-[2px_2px_0_var(--color-ink)]">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink">
                WINS
              </span>
              <p className="mt-1 font-display text-2xl sm:text-3xl">{profile.gamesWon}</p>
            </div>

            <div className="border-2 border-ink bg-paper p-3 text-center shadow-[2px_2px_0_var(--color-ink)]">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                WIN RATE
              </span>
              <p className="mt-1 font-display text-2xl sm:text-3xl">{rate}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 border-t-2 border-ink pt-5">
            {session?.user.isRegistered && friendshipState === 'none' && (
              <button
                type="button"
                onClick={() => void requestFriend()}
                disabled={isRequesting}
                className="brutal-btn flex w-full items-center justify-center gap-2 bg-confirmed-green text-white"
              >
                <UserPlus size={18} strokeWidth={2.5} />
                <span>{isRequesting ? 'Sending Request...' : 'Send Friend Request'}</span>
              </button>
            )}

            {friendshipState === 'friends' && (
              <div className="flex items-center justify-center gap-2 border-2 border-ink bg-confirmed-green/20 p-3 font-mono text-xs font-bold text-confirmed-green">
                <UserCheck size={16} strokeWidth={2.5} />
                <span>Connected as Friend</span>
              </div>
            )}

            {friendshipState === 'outgoing' && (
              <div className="border-2 border-ink bg-paper p-3 text-center font-mono text-xs font-bold uppercase text-ink-muted">
                Friend Request Pending
              </div>
            )}

            {friendshipState === 'incoming' && (
              <div className="flex items-center justify-between border-2 border-ink bg-caution-yellow/30 p-3 font-mono text-xs font-bold">
                <span>Player sent you a friend request!</span>
                <button
                  type="button"
                  onClick={() => setLocation('/profile?tab=friends')}
                  className="brutal-btn brutal-btn-compact text-xs bg-ink text-paper"
                >
                  Review Request
                </button>
              </div>
            )}

            {!session?.user.isRegistered && (
              <div className="border-2 border-ink bg-paper p-3 text-center">
                <p className="font-mono text-xs text-ink-muted">
                  Sign in to connect and send friend requests.
                </p>
                <button
                  type="button"
                  onClick={() => setLocation('/auth')}
                  className="brutal-btn brutal-btn-compact mt-2 bg-caution-yellow text-xs text-ink"
                >
                  Sign In
                </button>
              </div>
            )}
          </div>

          {(error || requestError) && (
            <p role="alert" className="mb-6 border-3 border-ink bg-evidence-red p-3 text-center font-mono text-sm font-bold text-white shadow-[4px_4px_0_var(--color-ink)]">
              {error || requestError}
            </p>
          )}
        </section>
      </main>
    </div>
  );
};
