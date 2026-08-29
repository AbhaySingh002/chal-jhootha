import React, { useEffect, useState } from 'react';
import { Trophy, UserPlus } from 'lucide-react';
import { useLocation, useRoute } from 'wouter';
import { useSession } from '../lib/auth';
import { createFriendRequest, getPublicProfile, type FriendshipState, type PlayerProfile } from '../lib/profile';
import { PageHeader } from '../components/PageHeader';

export const PublicProfile: React.FC = () => {
  const [, params] = useRoute('/players/:handle');
  const [, setLocation] = useLocation();
  const { data: session, isPending } = useSession();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [friendshipState, setFriendshipState] = useState<FriendshipState>('none');
  const [error, setError] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    if (isPending || !params?.handle) return;
    let active = true;
    void getPublicProfile(params.handle)
      .then((result) => {
        if (!active) return;
        setProfile(result.profile);
        setFriendshipState(result.friendshipState);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Player not found.'); });
    return () => { active = false; };
  }, [isPending, params?.handle]);

  const requestFriend = async () => {
    if (!profile) return;
    setIsRequesting(true);
    setError('');
    try {
      await createFriendRequest(profile.userId);
      setFriendshipState('outgoing');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send a friend request.');
    } finally {
      setIsRequesting(false);
    }
  };

  if (isPending || (!profile && !error)) {
    return <div className="page-shell"><PageHeader title="Player record" /><main className="page-container animate-pulse"><div className="h-80 border-3 border-ink bg-surface-muted" /></main></div>;
  }

  if (!profile) {
    return <div className="page-shell"><PageHeader title="Player record" /><main className="page-container max-w-xl"><section role="alert" className="brutal-card border-evidence-red p-5"><h1 className="font-display text-3xl uppercase text-evidence-red">Player unavailable</h1><p className="mt-3 font-mono text-sm leading-6 text-ink-muted">{error}</p><button type="button" onClick={() => setLocation('/profile')} className="brutal-btn mt-6 bg-caution-yellow text-ink">Find another player</button></section></main></div>;
  }

  const rate = profile.gamesPlayed === 0 ? '0%' : `${Math.round((profile.gamesWon / profile.gamesPlayed) * 100)}%`;
  const friendMessage = friendshipState === 'outgoing' ? 'Friend request sent.' : friendshipState === 'friends' ? 'You are friends.' : friendshipState === 'incoming' ? 'This player has sent you a request. Review it in your profile.' : null;

  return (
    <div className="page-shell">
      <PageHeader title="Public player record" backTo="/profile" />
      <main id="main-content" className="page-container max-w-2xl pb-8">
        <section className="brutal-card p-4 sm:p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-evidence-red">Public player record</p>
          <h1 className="mt-3 break-words font-display text-[clamp(2.75rem,14vw,5.5rem)] leading-[0.86] tracking-[-0.06em]">@{profile.handle}</h1>
          <p className="mt-3 font-mono text-base font-bold uppercase">{profile.displayName}</p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Player statistics">
            <div className="border-3 border-ink bg-paper p-3"><p className="font-mono text-xs font-bold uppercase text-ink-muted">Games</p><p className="mt-2 font-display text-3xl">{profile.gamesPlayed}</p></div>
            <div className="border-3 border-ink bg-caution-yellow p-3"><p className="font-mono text-xs font-bold uppercase">Wins</p><p className="mt-2 font-display text-3xl">{profile.gamesWon}</p></div>
            <div className="col-span-2 border-3 border-ink bg-paper p-3 sm:col-span-1"><p className="font-mono text-xs font-bold uppercase text-ink-muted">Rate</p><p className="mt-2 font-display text-3xl">{rate}</p></div>
          </div>

          {session?.user.isRegistered && friendshipState === 'none' ? <button type="button" onClick={() => void requestFriend()} disabled={isRequesting} className="brutal-btn mt-6 flex w-full items-center justify-center gap-2 bg-confirmed-green text-white"><UserPlus size={19} strokeWidth={2.5} />{isRequesting ? 'Sending request' : 'Add friend'}</button> : null}
          {friendMessage ? <p className="mt-6 flex items-center gap-2 border-2 border-ink bg-paper p-3 font-mono text-sm font-bold"><Trophy size={18} className="text-caution-yellow" strokeWidth={2.5} />{friendMessage}</p> : null}
          {error ? <p role="alert" className="mt-4 border-2 border-ink bg-evidence-red p-3 font-mono text-xs font-bold text-white">{error}</p> : null}
        </section>
      </main>
    </div>
  );
};
