import React, { useEffect, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { useSession } from '../lib/auth';
import { createFriendRequest, getPublicProfile, type FriendshipState, type PlayerProfile } from '../lib/profile';

export const PublicProfile: React.FC = () => {
  const [, params] = useRoute('/players/:handle');
  const [, setLocation] = useLocation();
  const { data: session, isPending } = useSession();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [friendshipState, setFriendshipState] = useState<FriendshipState>('none');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isPending || !params?.handle) return;
    let active = true;
    void getPublicProfile(params.handle)
      .then((result) => {
        if (!active) return;
        setProfile(result.profile);
        setFriendshipState(result.friendshipState);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Player not found');
      });
    return () => {
      active = false;
    };
  }, [isPending, params?.handle]);

  const requestFriend = async () => {
    if (!profile) return;
    try {
      await createFriendRequest(profile.userId);
      setFriendshipState('outgoing');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send request');
    }
  };

  if (isPending || (!profile && !error)) {
    return <div className="min-h-screen bg-paper flex items-center justify-center font-mono font-bold">LOADING PLAYER…</div>;
  }
  if (!profile) {
    return <div className="min-h-screen bg-paper flex items-center justify-center p-4 font-mono font-bold text-evidence-red">{error}</div>;
  }
  const winRate = profile.gamesPlayed === 0 ? '0%' : `${Math.round((profile.gamesWon / profile.gamesPlayed) * 100)}%`;

  return (
    <div className="min-h-screen bg-paper p-4 pt-20 font-sans">
      <button onClick={() => setLocation('/')} className="absolute top-4 left-4 brutal-btn py-2 px-4 bg-white">BACK</button>
      <main className="max-w-xl mx-auto brutal-card bg-white p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-evidence-red">Public player record</p>
        <h1 className="text-5xl font-display font-black uppercase tracking-tighter mt-2">@{profile.handle}</h1>
        <p className="font-mono text-lg font-bold mt-2">{profile.displayName}</p>
        <div className="grid grid-cols-3 gap-3 mt-6">
          <div className="brutal-border p-3"><p className="font-mono text-[10px] uppercase text-ink/55">Games</p><p className="font-display text-3xl">{profile.gamesPlayed}</p></div>
          <div className="brutal-border p-3 bg-caution-yellow"><p className="font-mono text-[10px] uppercase text-ink/55">Wins</p><p className="font-display text-3xl">{profile.gamesWon}</p></div>
          <div className="brutal-border p-3"><p className="font-mono text-[10px] uppercase text-ink/55">Rate</p><p className="font-display text-3xl">{winRate}</p></div>
        </div>
        {session?.user.isRegistered && friendshipState === 'none' ? <button onClick={requestFriend} className="w-full brutal-btn bg-confirmed-green text-white mt-6">ADD FRIEND</button> : null}
        {friendshipState === 'outgoing' ? <p className="mt-6 font-mono text-xs font-bold uppercase">Friend request sent.</p> : null}
        {friendshipState === 'friends' ? <p className="mt-6 font-mono text-xs font-bold uppercase text-confirmed-green">You are friends.</p> : null}
        {friendshipState === 'incoming' ? <p className="mt-6 font-mono text-xs font-bold uppercase">This player has sent you a request. Review it in your profile.</p> : null}
        {error ? <p className="mt-4 font-mono text-xs text-evidence-red">{error}</p> : null}
      </main>
    </div>
  );
};
