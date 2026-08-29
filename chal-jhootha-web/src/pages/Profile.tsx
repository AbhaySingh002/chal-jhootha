import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { signOut, useSession } from '../lib/auth';
import {
  createFriendRequest,
  createMyProfile,
  getFriendships,
  getMyProfile,
  getPublicProfile,
  getRecentPlayers,
  removeFriendship,
  respondToFriendRequest,
  updateMyProfile,
  type Friendship,
  type FriendshipState,
  type PlayerProfile,
} from '../lib/profile';

type SearchResult = { profile: PlayerProfile; friendshipState: FriendshipState };

function winRate(profile: PlayerProfile) {
  return profile.gamesPlayed === 0 ? '0%' : `${Math.round((profile.gamesWon / profile.gamesPlayed) * 100)}%`;
}

export const Profile: React.FC = () => {
  const { data: session, isPending } = useSession();
  const [, setLocation] = useLocation();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [recentPlayers, setRecentPlayers] = useState<PlayerProfile[]>([]);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [searchHandle, setSearchHandle] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user.isRegistered) {
      setLocation('/auth');
      return;
    }
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const mine = await getMyProfile();
        if (!active) return;
        setProfile(mine.profile);
        if (mine.profile) {
          setHandle(mine.profile.handle);
          setDisplayName(mine.profile.displayName);
          const [friendData, recentData] = await Promise.all([getFriendships(), getRecentPlayers()]);
          if (!active) return;
          setFriends(friendData.friendships);
          setRecentPlayers(recentData.players);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load profile');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [isPending, refreshKey, session?.user.isRegistered, setLocation]);

  const refreshSocial = () => setRefreshKey((value) => value + 1);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      const result = profile
        ? await updateMyProfile(handle, displayName)
        : await createMyProfile(handle);
      setProfile(result.profile);
      setHandle(result.profile.handle);
      setDisplayName(result.profile.displayName);
      if (!profile) refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  const findPlayer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!searchHandle.trim()) return;
    setError('');
    try {
      setSearchResult(await getPublicProfile(searchHandle.trim().toLowerCase()));
    } catch (cause) {
      setSearchResult(null);
      setError(cause instanceof Error ? cause.message : 'Player not found');
    }
  };

  const requestFriend = async (targetUserId: string) => {
    setError('');
    try {
      await createFriendRequest(targetUserId);
      if (searchResult?.profile.userId === targetUserId) {
        setSearchResult({ ...searchResult, friendshipState: 'outgoing' });
      }
      refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send request');
    }
  };

  const respondToRequest = async (id: string, accept: boolean) => {
    setError('');
    try {
      await respondToFriendRequest(id, accept);
      refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update request');
    }
  };

  const unfriend = async (id: string) => {
    setError('');
    try {
      await removeFriendship(id);
      refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove friend');
    }
  };

  if (isPending || isLoading) {
    return <div className="min-h-screen bg-paper flex items-center justify-center font-mono font-bold">LOADING DOSSIER…</div>;
  }
  if (!session?.user.isRegistered) return null;

  const acceptedFriends = friends.filter((friendship) => friendship.direction === 'friend');
  const incomingRequests = friends.filter((friendship) => friendship.direction === 'incoming');

  return (
    <div className="min-h-screen p-4 bg-paper relative z-10 pt-20 font-sans">
      <div className="absolute top-4 left-4">
        <button onClick={() => setLocation('/')} className="brutal-btn py-2 px-4 bg-white">BACK</button>
      </div>
      <div className="absolute top-4 right-4">
        <button onClick={async () => { await signOut(); setLocation('/'); }} className="brutal-btn py-2 px-4 bg-evidence-red text-white">LOGOUT</button>
      </div>

      <main className="max-w-4xl mx-auto space-y-6">
        {error ? <div className="brutal-border bg-evidence-red text-white p-3 font-mono text-xs uppercase">{error}</div> : null}

        <section className="brutal-card p-6 sm:p-8 bg-white">
          <p className="font-mono text-xs font-bold text-evidence-red uppercase tracking-widest">Player dossier</p>
          <h1 className="text-5xl font-display font-black text-ink uppercase tracking-tighter mt-1">
            {profile ? `@${profile.handle}` : 'COMPLETE YOUR PROFILE'}
          </h1>
          <p className="font-mono text-sm text-ink/65 mt-2">
            {profile ? 'Your public handle, record, and trusted suspects.' : 'Choose the public handle other players can use to find you.'}
          </p>

          <form onSubmit={saveProfile} className="grid sm:grid-cols-2 gap-4 mt-6 border-t-2 border-ink/20 pt-5">
            <label className="font-mono text-xs font-bold uppercase">
              Handle
              <input
                value={handle}
                onChange={(event) => setHandle(event.target.value.toLowerCase())}
                className="w-full brutal-input mt-2"
                minLength={3}
                maxLength={16}
                pattern="[a-z0-9_]{3,16}"
                required
              />
            </label>
            {profile ? (
              <label className="font-mono text-xs font-bold uppercase">
                Display name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full brutal-input mt-2"
                  maxLength={16}
                  required
                />
              </label>
            ) : null}
            <button disabled={isSaving} className="brutal-btn bg-confirmed-green text-white sm:col-span-2 disabled:opacity-60">
              {isSaving ? 'SAVING…' : profile ? 'SAVE PROFILE' : 'CREATE PROFILE'}
            </button>
          </form>
        </section>

        {profile ? (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="brutal-border p-4 bg-white">
                <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Matches played</p>
                <p className="text-4xl font-display mt-2">{profile.gamesPlayed}</p>
              </div>
              <div className="brutal-border p-4 bg-caution-yellow">
                <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Official wins</p>
                <p className="text-4xl font-display mt-2">{profile.gamesWon}</p>
              </div>
              <div className="brutal-border p-4 bg-white col-span-2 sm:col-span-1">
                <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Win rate</p>
                <p className="text-4xl font-display mt-2">{winRate(profile)}</p>
              </div>
            </section>

            <section className="brutal-card p-6 bg-white">
              <h2 className="text-2xl font-display font-black uppercase">Find a player</h2>
              <form onSubmit={findPlayer} className="flex gap-2 mt-4">
                <input value={searchHandle} onChange={(event) => setSearchHandle(event.target.value.toLowerCase())} className="brutal-input flex-1" placeholder="handle" />
                <button className="brutal-btn bg-caution-yellow text-ink">SEARCH</button>
              </form>
              {searchResult ? (
                <div className="mt-4 border-2 border-ink p-3 flex flex-wrap gap-3 items-center justify-between bg-paper">
                  <div>
                    <p className="font-mono font-bold uppercase">{searchResult.profile.displayName} <span className="text-ink/55">@{searchResult.profile.handle}</span></p>
                    <p className="font-mono text-xs text-ink/65">{searchResult.profile.gamesWon} wins / {searchResult.profile.gamesPlayed} games</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setLocation(`/players/${searchResult.profile.handle}`)} className="brutal-btn bg-white text-ink text-xs">VIEW</button>
                    {searchResult.friendshipState === 'none' ? <button type="button" onClick={() => requestFriend(searchResult.profile.userId)} className="brutal-btn bg-confirmed-green text-white text-xs">ADD FRIEND</button> : null}
                    {searchResult.friendshipState === 'outgoing' ? <span className="font-mono text-xs font-bold">REQUEST SENT</span> : null}
                    {searchResult.friendshipState === 'friends' ? <span className="font-mono text-xs font-bold">FRIENDS</span> : null}
                    {searchResult.friendshipState === 'incoming' ? <span className="font-mono text-xs font-bold">CHECK REQUESTS</span> : null}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="grid md:grid-cols-2 gap-6">
              <div className="brutal-card p-6 bg-white">
                <h2 className="text-2xl font-display font-black uppercase">Friend requests</h2>
                <div className="mt-4 space-y-3">
                  {incomingRequests.length === 0 ? <p className="font-mono text-xs text-ink/60">No pending requests.</p> : incomingRequests.map((request) => (
                    <div key={request.id} className="border-2 border-ink p-3 flex items-center justify-between gap-3">
                      <span className="font-mono font-bold truncate">@{request.profile.handle}</span>
                      <span className="flex gap-2">
                        <button onClick={() => respondToRequest(request.id, true)} className="brutal-btn bg-confirmed-green text-white text-xs">ACCEPT</button>
                        <button onClick={() => respondToRequest(request.id, false)} className="brutal-btn bg-white text-ink text-xs">DECLINE</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="brutal-card p-6 bg-white">
                <h2 className="text-2xl font-display font-black uppercase">Friends</h2>
                <div className="mt-4 space-y-3">
                  {acceptedFriends.length === 0 ? <p className="font-mono text-xs text-ink/60">No friends yet. Meet players in a completed game or search their handle.</p> : acceptedFriends.map((friendship) => (
                    <div key={friendship.id} className="border-2 border-ink p-3 flex items-center justify-between gap-3">
                      <button onClick={() => setLocation(`/players/${friendship.profile.handle}`)} className="font-mono font-bold text-left truncate hover:underline">@{friendship.profile.handle}</button>
                      <button onClick={() => unfriend(friendship.id)} className="brutal-btn bg-white text-ink text-xs">REMOVE</button>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="brutal-card p-6 bg-white">
              <h2 className="text-2xl font-display font-black uppercase">Recent opponents</h2>
              <div className="mt-4 grid sm:grid-cols-2 gap-3">
                {recentPlayers.length === 0 ? <p className="font-mono text-xs text-ink/60">Complete a game with another registered player to see them here.</p> : recentPlayers.map((player) => (
                  <div key={player.userId} className="border-2 border-ink p-3 flex items-center justify-between gap-3">
                    <button onClick={() => setLocation(`/players/${player.handle}`)} className="font-mono font-bold text-left truncate hover:underline">@{player.handle}</button>
                    <button onClick={() => requestFriend(player.userId)} className="brutal-btn bg-caution-yellow text-ink text-xs">ADD</button>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
};
