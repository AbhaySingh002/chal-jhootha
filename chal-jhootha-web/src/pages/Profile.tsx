import React, { useEffect, useState } from 'react';
import { LogOut, Search, UserPlus, Users } from 'lucide-react';
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
import { PageHeader } from '../components/PageHeader';

type SearchResult = { profile: PlayerProfile; friendshipState: FriendshipState };

function winRate(profile: PlayerProfile) {
  return profile.gamesPlayed === 0 ? '0%' : `${Math.round((profile.gamesWon / profile.gamesPlayed) * 100)}%`;
}

function LoadingProfile() {
  return (
    <div className="page-shell">
      <PageHeader title="Player profile" />
      <main className="page-container animate-pulse space-y-5" aria-label="Loading profile">
        <div className="h-52 border-3 border-ink bg-surface-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="h-28 border-3 border-ink bg-surface-muted" /><div className="h-28 border-3 border-ink bg-surface-muted" /><div className="col-span-2 h-28 border-3 border-ink bg-surface-muted sm:col-span-1" /></div>
      </main>
    </div>
  );
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
  const [isSearching, setIsSearching] = useState(false);
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
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load your profile. Try again shortly.');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [isPending, refreshKey, session?.user.isRegistered, setLocation]);

  const refreshSocial = () => setRefreshKey((value) => value + 1);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      const result = profile ? await updateMyProfile(handle, displayName) : await createMyProfile(handle);
      setProfile(result.profile);
      setHandle(result.profile.handle);
      setDisplayName(result.profile.displayName);
      if (!profile) refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save your profile. Check the highlighted details.');
    } finally {
      setIsSaving(false);
    }
  };

  const findPlayer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!searchHandle.trim()) return;
    setIsSearching(true);
    setError('');
    try {
      setSearchResult(await getPublicProfile(searchHandle.trim().toLowerCase()));
    } catch (cause) {
      setSearchResult(null);
      setError(cause instanceof Error ? cause.message : 'Player not found. Check the handle and try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const requestFriend = async (targetUserId: string) => {
    setError('');
    try {
      await createFriendRequest(targetUserId);
      if (searchResult?.profile.userId === targetUserId) setSearchResult({ ...searchResult, friendshipState: 'outgoing' });
      refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send the friend request.');
    }
  };

  const respondToRequest = async (id: string, accept: boolean) => {
    setError('');
    try {
      await respondToFriendRequest(id, accept);
      refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update that request.');
    }
  };

  const unfriend = async (id: string) => {
    if (!window.confirm('Remove this player from your friends?')) return;
    setError('');
    try {
      await removeFriendship(id);
      refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove this friend.');
    }
  };

  if (isPending || isLoading) return <LoadingProfile />;
  if (!session?.user.isRegistered) return null;

  const acceptedFriends = friends.filter((friendship) => friendship.direction === 'friend');
  const incomingRequests = friends.filter((friendship) => friendship.direction === 'incoming');
  const headerAction = <button type="button" onClick={async () => { await signOut(); setLocation('/'); }} className="brutal-btn brutal-btn-compact bg-evidence-red text-white"><LogOut size={16} className="inline-block" strokeWidth={2.5} /><span className="sr-only">Log out</span></button>;

  return (
    <div className="page-shell">
      <PageHeader title="Player profile" action={headerAction} />
      <main id="main-content" className="page-container space-y-6 pb-8">
        {error ? <p role="alert" className="border-2 border-ink bg-evidence-red p-3 font-mono text-xs font-bold leading-5 text-white">{error}</p> : null}

        <section className="brutal-card p-4 sm:p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-evidence-red">Player record</p>
          <h1 className="mt-2 break-words font-display text-[clamp(2.25rem,10vw,4.5rem)] leading-[0.9] uppercase tracking-[-0.055em]">{profile ? `@${profile.handle}` : 'Complete your profile'}</h1>
          <p className="mt-3 max-w-2xl font-mono text-sm leading-6 text-ink-muted">{profile ? 'Edit your public identity and keep track of the people you play with.' : 'Choose the public handle other players can use to find you.'}</p>

          <form onSubmit={saveProfile} className="mt-6 grid gap-4 border-t-2 border-ink pt-5 md:grid-cols-2">
            <div>
              <label htmlFor="profile-handle" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Handle</label>
              <input id="profile-handle" value={handle} onChange={(event) => setHandle(event.target.value.toLowerCase())} className="brutal-input" minLength={3} maxLength={16} pattern="[a-z0-9_]{3,16}" autoComplete="username" required />
            </div>
            {profile ? <div><label htmlFor="profile-display-name" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.12em]">Display name</label><input id="profile-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="brutal-input" maxLength={16} autoComplete="name" required /></div> : null}
            <button disabled={isSaving} className="brutal-btn bg-confirmed-green text-white md:col-span-2">{isSaving ? 'Saving' : profile ? 'Save profile' : 'Create profile'}</button>
          </form>
        </section>

        {profile ? (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4" aria-label="Match statistics">
              <div className="brutal-card p-4"><p className="font-mono text-xs font-bold uppercase text-ink-muted">Matches played</p><p className="mt-3 font-display text-4xl">{profile.gamesPlayed}</p></div>
              <div className="brutal-card bg-caution-yellow p-4"><p className="font-mono text-xs font-bold uppercase text-ink">Official wins</p><p className="mt-3 font-display text-4xl">{profile.gamesWon}</p></div>
              <div className="brutal-card col-span-2 p-4 sm:col-span-1"><p className="font-mono text-xs font-bold uppercase text-ink-muted">Win rate</p><p className="mt-3 font-display text-4xl">{winRate(profile)}</p></div>
            </section>

            <section className="brutal-card p-4 sm:p-6">
              <h2 className="font-display text-2xl uppercase">Find a player</h2>
              <form onSubmit={findPlayer} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div><label htmlFor="player-search" className="sr-only">Player handle</label><input id="player-search" value={searchHandle} onChange={(event) => setSearchHandle(event.target.value.toLowerCase())} className="brutal-input" placeholder="player handle" autoComplete="off" /></div>
                <button disabled={isSearching || !searchHandle.trim()} className="brutal-btn flex items-center justify-center gap-2 bg-caution-yellow text-ink"><Search size={18} strokeWidth={2.5} />{isSearching ? 'Searching' : 'Search'}</button>
              </form>
              {searchResult ? (
                <div className="mt-4 grid gap-3 border-2 border-ink bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0"><p className="truncate font-mono font-bold uppercase">{searchResult.profile.displayName} <span className="text-ink-muted">@{searchResult.profile.handle}</span></p><p className="mt-1 font-mono text-xs text-ink-muted">{searchResult.profile.gamesWon} wins from {searchResult.profile.gamesPlayed} games</p></div>
                  <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setLocation(`/players/${searchResult.profile.handle}`)} className="brutal-btn brutal-btn-compact bg-surface text-ink">View</button>{searchResult.friendshipState === 'none' ? <button type="button" onClick={() => void requestFriend(searchResult.profile.userId)} className="brutal-btn brutal-btn-compact bg-confirmed-green text-white">Add friend</button> : <span className="self-center font-mono text-xs font-bold uppercase">{searchResult.friendshipState === 'outgoing' ? 'Request sent' : searchResult.friendshipState === 'friends' ? 'Friends' : 'Check requests'}</span>}</div>
                </div>
              ) : null}
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="brutal-card p-4 sm:p-6"><h2 className="font-display text-2xl uppercase">Friend requests</h2><div className="mt-4 space-y-3">{incomingRequests.length === 0 ? <p className="font-mono text-sm leading-6 text-ink-muted">No pending requests.</p> : incomingRequests.map((request) => <div key={request.id} className="grid gap-3 border-2 border-ink bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><span className="truncate font-mono font-bold">@{request.profile.handle}</span><span className="flex gap-2"><button type="button" onClick={() => void respondToRequest(request.id, true)} className="brutal-btn brutal-btn-compact bg-confirmed-green text-white">Accept</button><button type="button" onClick={() => void respondToRequest(request.id, false)} className="brutal-btn brutal-btn-compact bg-surface text-ink">Decline</button></span></div>)}</div></div>
              <div className="brutal-card p-4 sm:p-6"><h2 className="font-display text-2xl uppercase">Friends</h2><div className="mt-4 space-y-3">{acceptedFriends.length === 0 ? <p className="font-mono text-sm leading-6 text-ink-muted">No friends yet. Search a handle or meet players in a completed game.</p> : acceptedFriends.map((friendship) => <div key={friendship.id} className="grid gap-3 border-2 border-ink bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><button type="button" onClick={() => setLocation(`/players/${friendship.profile.handle}`)} className="truncate text-left font-mono font-bold underline underline-offset-4">@{friendship.profile.handle}</button><button type="button" onClick={() => void unfriend(friendship.id)} className="brutal-btn brutal-btn-compact bg-evidence-red text-white">Remove</button></div>)}</div></div>
            </section>

            <section className="brutal-card p-4 sm:p-6"><div className="flex items-center gap-2"><Users size={22} className="text-evidence-red" strokeWidth={2.5} /><h2 className="font-display text-2xl uppercase">Recent opponents</h2></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{recentPlayers.length === 0 ? <p className="font-mono text-sm leading-6 text-ink-muted">Complete a game with another registered player to see them here.</p> : recentPlayers.map((player) => <div key={player.userId} className="grid gap-3 border-2 border-ink bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><button type="button" onClick={() => setLocation(`/players/${player.handle}`)} className="truncate text-left font-mono font-bold underline underline-offset-4">@{player.handle}</button><button type="button" onClick={() => void requestFriend(player.userId)} className="brutal-btn brutal-btn-compact flex items-center justify-center gap-1 bg-caution-yellow text-ink"><UserPlus size={16} strokeWidth={2.5} />Add</button></div>)}</div></section>
          </>
        ) : null}
      </main>
    </div>
  );
};
