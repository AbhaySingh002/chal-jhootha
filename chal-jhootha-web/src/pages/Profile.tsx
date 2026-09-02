import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import clsx from 'clsx';
import {
  Check,
  Flame,
  Loader2,
  LogIn,
  LogOut,
  Search,
  Shield,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { signOut, useSession } from '../lib/auth';
import {
  createMyProfile,
  getFriendships,
  getMyProfile,
  getPublicProfile,
  getRecentPlayers,
  removeFriendship,
  respondToFriendRequest,
  updateMyProfile,
  updateMyPassword,
  calculateWinRate,
  useFriendRequest,
  type Friendship,
  type FriendshipState,
  type PlayerProfile,
} from '../lib/profile';
import { Navbar } from '../components/Navbar';

type TabType = 'overview' | 'friends' | 'find';
type SearchResult = { profile: PlayerProfile; friendshipState: FriendshipState };

const AVATAR_OPTIONS = [
  { id: 'ace-spades', label: 'Ace of Spades', rank: 'A', suit: '♠', isRed: false },
  { id: 'king-hearts', label: 'King of Hearts', rank: 'K', suit: '♥', isRed: true },
  { id: 'queen-diamonds', label: 'Queen of Diamonds', rank: 'Q', suit: '♦', isRed: true },
  { id: 'jack-clubs', label: 'Jack of Clubs', rank: 'J', suit: '♣', isRed: false },
  { id: 'joker-red', label: 'Red Joker', rank: 'JR', suit: '★', isRed: true },
  { id: 'joker-black', label: 'Black Joker', rank: 'JB', suit: '★', isRed: false },
];



export const Profile: React.FC = () => {
  const { data: session, isPending } = useSession();
  const [location, setLocation] = useLocation();

  // Read tab from query parameter if present
  const initialTab: TabType = location.includes('tab=friends')
    ? 'friends'
    : location.includes('tab=find')
    ? 'find'
    : 'overview';

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [recentPlayers, setRecentPlayers] = useState<PlayerProfile[]>([]);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarId, setAvatarId] = useState('ace-spades');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [searchHandle, setSearchHandle] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const { requestFriend: sendFriendRequest, error: requestError, setError: setRequestError } = useFriendRequest();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const isRegistered = session?.user?.isRegistered === true;

  useEffect(() => {
    if (isPending) return;
    if (!isRegistered) return;

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
          setAvatarId(mine.profile.avatarId);
          const [friendData, recentData] = await Promise.all([
            getFriendships(),
            getRecentPlayers(),
          ]);
          if (!active) return;
          setFriends(friendData.friendships);
          setRecentPlayers(recentData.players);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Unable to load profile data.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [isPending, refreshKey, isRegistered]);

  const refreshSocial = () => setRefreshKey((value) => value + 1);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      const result = profile
        ? await updateMyProfile(handle, displayName, avatarId)
        : await createMyProfile(handle);
      setProfile(result.profile);
      setHandle(result.profile.handle);
      setDisplayName(result.profile.displayName);
      setAvatarId(result.profile.avatarId);
      setSuccessMsg('Profile updated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      if (!profile) refreshSocial();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccessMsg('');
    try {
      await updateMyPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setSuccessMsg('Password updated. Other sessions were signed out.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update password.');
    }
  };

  // Debounced search for player handles
  useEffect(() => {
    const query = searchHandle.trim().toLowerCase();
    if (query.length < 3) {
      setSearchResult(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setError('');
      setRequestError('');
      try {
        const res = await getPublicProfile(query);
        setSearchResult(res);
      } catch (cause) {
        setSearchResult(null);
        if (searchHandle.trim().toLowerCase() === query) {
          setError(cause instanceof Error ? cause.message : 'Player not found.');
        }
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchHandle]);

  const findPlayer = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchHandle.trim().toLowerCase();
    if (!query) return;
    setIsSearching(true);
    setError('');
    setRequestError('');
    try {
      const res = await getPublicProfile(query);
      setSearchResult(res);
    } catch (cause) {
      setSearchResult(null);
      setError(cause instanceof Error ? cause.message : 'Player not found.');
    } finally {
      setIsSearching(false);
    }
  };

  const requestFriend = async (targetUserId: string) => {
    setError('');
    await sendFriendRequest(targetUserId, () => {
      if (searchResult?.profile.userId === targetUserId) {
        setSearchResult({ ...searchResult, friendshipState: 'outgoing' });
      }
      refreshSocial();
    });
  };

  const respondToRequest = async (id: string, accept: boolean) => {
    setError('');
    setRequestError('');
    const target = friends.find((f) => f.id === id);
    if (!target) return;

    // Optimistic UI mutation
    setFriends((prev) => {
      if (accept) {
        return prev.map((f) => f.id === id ? { ...f, direction: 'friend' as const, status: 'accepted' as const } : f);
      }
      return prev.filter((f) => f.id !== id);
    });

    try {
      await respondToFriendRequest(id, accept);
      refreshSocial();
    } catch (cause) {
      refreshSocial();
      setError(cause instanceof Error ? cause.message : 'Unable to update friend request.');
    }
  };

  const unfriend = async (id: string) => {
    if (!window.confirm('Remove this friend?')) return;
    setError('');
    const previous = friends;
    // Optimistic removal
    setFriends((prev) => prev.filter((f) => f.id !== id));
    try {
      await removeFriendship(id);
      refreshSocial();
    } catch (cause) {
      setFriends(previous);
      setError(cause instanceof Error ? cause.message : 'Unable to remove friend.');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setLocation('/');
  };

  if (isPending || (isRegistered && isLoading)) {
    return (
      <div className="page-shell">
        <Navbar currentTab={activeTab === 'friends' ? 'friends' : 'profile'} />
        <main className="page-container max-w-4xl animate-pulse space-y-6 pb-12 pt-4">
          <div className="h-48 border-3 border-ink bg-surface shadow-[4px_4px_0_var(--color-ink)]" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="h-24 border-3 border-ink bg-surface" />
            <div className="h-24 border-3 border-ink bg-surface" />
            <div className="col-span-2 h-24 border-3 border-ink bg-surface sm:col-span-1" />
          </div>
        </main>
      </div>
    );
  }

  // Guest Unauthenticated State
  if (!isRegistered) {
    return (
      <div className="page-shell">
        <Navbar currentTab="profile" />
        <main className="page-container max-w-xl pb-12 pt-6">
          <section className="brutal-card p-6 sm:p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border-2 border-ink bg-caution-yellow shadow-[3px_3px_0_var(--color-ink)]">
              <Shield size={28} className="text-ink" strokeWidth={2.5} />
            </div>
            <h1 className="font-display text-3xl uppercase tracking-tight sm:text-4xl">
              PLAYER HUB
            </h1>
            <p className="mt-2 font-mono text-sm leading-relaxed text-ink-muted">
              Create a registered account to track match stats, add friends, manage requests, and view public records.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => setLocation('/auth')}
                className="brutal-btn flex items-center justify-center gap-2 bg-confirmed-green text-white"
              >
                <LogIn size={17} strokeWidth={2.5} />
                <span>SIGN IN / REGISTER</span>
              </button>
              <button
                type="button"
                onClick={() => setLocation('/')}
                className="brutal-btn bg-surface text-ink"
              >
                BACK TO LOBBY
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const acceptedFriends = friends.filter((f) => f.direction === 'friend');
  const incomingRequests = friends.filter((f) => f.direction === 'incoming');
  const outgoingRequests = friends.filter((f) => f.direction === 'outgoing');

  return (
    <div className="page-shell">
      <Navbar currentTab={activeTab === 'friends' ? 'friends' : 'profile'} />

      <main id="main-content" className="page-container max-w-4xl space-y-6 pb-12">
        {/* Navigation Tabs Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`brutal-btn brutal-btn-compact text-xs ${
                activeTab === 'overview' ? 'bg-ink text-paper' : 'bg-surface text-ink'
              }`}
            >
              <Shield size={14} strokeWidth={2.5} className="inline mr-1" />
              <span>Record & Stats</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('friends')}
              className={`brutal-btn brutal-btn-compact relative text-xs ${
                activeTab === 'friends' ? 'bg-ink text-paper' : 'bg-surface text-ink'
              }`}
            >
              <Users size={14} strokeWidth={2.5} className="inline mr-1" />
              <span>Friends ({acceptedFriends.length})</span>
              {incomingRequests.length > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center border border-ink bg-evidence-red px-1 font-mono text-[9px] font-bold text-white">
                  {incomingRequests.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('find')}
              className={`brutal-btn brutal-btn-compact text-xs ${
                activeTab === 'find' ? 'bg-ink text-paper' : 'bg-surface text-ink'
              }`}
            >
              <Search size={14} strokeWidth={2.5} className="inline mr-1" />
              <span>Find Players</span>
            </button>
          </div>
        </div>

        {(error || requestError) && (
          <p role="alert" className="mb-6 border-3 border-ink bg-evidence-red p-3 text-center font-mono text-sm font-bold text-white shadow-[4px_4px_0_var(--color-ink)]">
            {error || requestError}
          </p>
        )}

        {successMsg && (
          <p role="status" className="border-2 border-ink bg-confirmed-green p-3 font-mono text-xs font-bold text-white shadow-[2px_2px_0_var(--color-ink)]">
            {successMsg}
          </p>
        )}

        {/* TAB 1: OVERVIEW & STATS */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {profile && (
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                <div className="brutal-card p-4">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    MATCHES
                  </span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-display text-3xl sm:text-4xl">{profile.gamesPlayed}</span>
                  </div>
                </div>

                <div className="brutal-card bg-caution-yellow p-4">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink">
                    VICTORIES
                  </span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <Trophy size={20} className="text-ink" strokeWidth={2.5} />
                    <span className="font-display text-3xl sm:text-4xl">{profile.gamesWon}</span>
                  </div>
                </div>

                <div className="brutal-card col-span-2 p-4 sm:col-span-1">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    WIN RATIO
                  </span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <Flame size={20} className="text-evidence-red" strokeWidth={2.5} />
                    <span className="font-display text-3xl sm:text-4xl">{calculateWinRate(profile.gamesPlayed, profile.gamesWon)}</span>
                  </div>
                </div>
              </section>
            )}

            {/* Profile Information Form */}
            <section className="brutal-card p-5 sm:p-7">
              <h2 className="font-display text-2xl uppercase tracking-tight">
                {profile ? 'Identity Details' : 'Create Identity'}
              </h2>
              <p className="mt-1 font-mono text-xs text-ink-muted">
                Your public handle is what friends and opponents use to find and add you.
              </p>

              <form onSubmit={saveProfile} className="mt-5 grid gap-4 border-t-2 border-ink pt-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="profile-handle" className="mb-1 block font-mono text-xs font-bold uppercase tracking-[0.1em]">
                    Handle
                  </label>
                  <input
                    id="profile-handle"
                    value={handle}
                    onChange={(event) => setHandle(event.target.value.toLowerCase())}
                    className="brutal-input text-sm"
                    minLength={3}
                    maxLength={16}
                    pattern="[a-z0-9_]{3,16}"
                    placeholder="player_handle"
                    autoComplete="username"
                    required
                  />
                </div>

                {profile && (
                  <div>
                    <label htmlFor="profile-display-name" className="mb-1 block font-mono text-xs font-bold uppercase tracking-[0.1em]">
                      Display Name
                    </label>
                    <input
                      id="profile-display-name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className="brutal-input text-sm"
                      maxLength={16}
                      autoComplete="name"
                      required
                    />
                  </div>
                )}

                {profile && (
                  <div className="sm:col-span-2">
                    <label id="profile-avatar-label" className="mb-2 block font-mono text-xs font-bold uppercase tracking-[0.1em]">
                      Deck Avatar
                    </label>
                    <div
                      role="radiogroup"
                      aria-labelledby="profile-avatar-label"
                      className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-2.5"
                    >
                      {AVATAR_OPTIONS.map((opt) => {
                        const isSelected = avatarId === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => setAvatarId(opt.id)}
                            className={clsx(
                              "relative flex flex-col items-center justify-between p-2 rounded-lg border-2 text-left h-24 sm:h-28 transition-all select-none",
                              isSelected
                                ? "border-ink bg-caution-yellow shadow-[3px_3px_0_var(--color-ink)] scale-[1.03]"
                                : "border-ink/35 bg-surface hover:border-ink hover:bg-surface-muted hover:-translate-y-0.5 active:scale-95"
                            )}
                          >
                            <div className="flex w-full items-center justify-between">
                              <span className={clsx("font-display text-sm sm:text-base font-bold leading-none", opt.isRed ? "text-evidence-red" : "text-ink")}>
                                {opt.rank}
                              </span>
                              {isSelected && (
                                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ink text-paper" aria-hidden="true">
                                  <Check size={9} strokeWidth={3.5} />
                                </span>
                              )}
                            </div>
                            <span className={clsx("font-display text-2xl sm:text-3xl leading-none select-none my-auto", opt.isRed ? "text-evidence-red" : "text-ink")}>
                              {opt.suit}
                            </span>
                            <span className="w-full truncate text-center font-mono text-[9px] sm:text-[10px] font-bold text-ink-muted">
                              {opt.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="brutal-btn bg-confirmed-green text-white"
                  >
                    {isSaving ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            </section>

            {profile && (
              <section className="brutal-card p-5 sm:p-7">
                <h2 className="font-display text-2xl uppercase tracking-tight">Password</h2>
                <p className="mt-1 font-mono text-xs text-ink-muted">Changing it signs out your other devices.</p>
                <form onSubmit={changePassword} className="mt-5 grid gap-4 border-t-2 border-ink pt-4 sm:grid-cols-2">
                  <input aria-label="Current password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="brutal-input text-sm" placeholder="Current password" autoComplete="current-password" required />
                  <input aria-label="New password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="brutal-input text-sm" placeholder="New password (6+ characters)" minLength={6} autoComplete="new-password" required />
                  <button type="submit" className="brutal-btn bg-ink text-paper sm:col-span-2">Update Password</button>
                </form>
              </section>
            )}
          </div>
        )}

        {/* TAB 2: FRIENDS & REQUESTS */}
        {activeTab === 'friends' && (
          <div className="space-y-6">
            {/* Incoming Requests */}
            {incomingRequests.length > 0 && (
              <section className="brutal-card border-evidence-red p-4 sm:p-6">
                <div className="mb-3 flex items-center justify-between border-b-2 border-ink pb-2">
                  <h2 className="font-display text-xl uppercase text-evidence-red">
                    Incoming Friend Requests ({incomingRequests.length})
                  </h2>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {incomingRequests.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between border-2 border-ink bg-paper p-3 shadow-[2px_2px_0_var(--color-ink)]"
                    >
                      <button
                        type="button"
                        onClick={() => setLocation(`/players/${req.profile.handle}`)}
                        className="truncate text-left font-mono text-sm font-bold uppercase hover:underline"
                      >
                        @{req.profile.handle}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void respondToRequest(req.id, true)}
                          className="icon-btn h-8 w-8 bg-confirmed-green text-white"
                          title="Accept"
                        >
                          <Check size={16} strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void respondToRequest(req.id, false)}
                          className="icon-btn h-8 w-8 bg-surface text-ink"
                          title="Decline"
                        >
                          <X size={16} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Friends List */}
            <section className="brutal-card p-4 sm:p-6">
              <div className="mb-4 flex items-center justify-between border-b-2 border-ink pb-3">
                <div>
                  <h2 className="font-display text-2xl uppercase">Friends Roster</h2>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">
                    {acceptedFriends.length} connected player{acceptedFriends.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('find')}
                  className="brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 bg-caution-yellow text-xs text-ink"
                >
                  <UserPlus size={14} strokeWidth={2.5} />
                  <span>Add Friend</span>
                </button>
              </div>

              {acceptedFriends.length === 0 ? (
                <div className="border-2 border-dashed border-ink/30 bg-paper p-8 text-center">
                  <p className="font-mono text-sm font-bold uppercase text-ink-muted">
                    No friends connected yet
                  </p>
                  <p className="mt-1 font-mono text-xs text-ink-muted">
                    Search a player handle or send a friend request to opponents you meet in matches.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('find')}
                    className="brutal-btn mt-4 inline-flex items-center gap-1.5 bg-confirmed-green text-xs text-white"
                  >
                    <Search size={14} strokeWidth={2.5} />
                    <span>Search Player Handles</span>
                  </button>
                </div>
              ) : (
                <ul className="grid gap-2.5 sm:grid-cols-2">
                  {acceptedFriends.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between border-2 border-ink bg-paper p-3 shadow-[2px_2px_0_var(--color-ink)]"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setLocation(`/players/${f.profile.handle}`)}
                          className="block truncate font-mono text-sm font-bold uppercase hover:underline"
                        >
                          @{f.profile.handle}
                        </button>
                        <span className="font-mono text-[10px] text-ink-muted">
                          {f.profile.gamesWon} wins • {calculateWinRate(f.profile.gamesPlayed, f.profile.gamesWon)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setLocation(`/players/${f.profile.handle}`)}
                          className="brutal-btn brutal-btn-compact text-xs bg-surface text-ink"
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          onClick={() => void unfriend(f.id)}
                          className="icon-btn h-8 w-8 border bg-evidence-red text-white"
                          title="Remove Friend"
                        >
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Outgoing Pending Requests */}
            {outgoingRequests.length > 0 && (
              <section className="brutal-card p-4 sm:p-5 opacity-80">
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-ink-muted">
                  Pending Sent Requests ({outgoingRequests.length})
                </h3>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {outgoingRequests.map((req) => (
                    <span
                      key={req.id}
                      className="inline-flex items-center gap-1.5 border border-ink bg-surface px-2.5 py-1 font-mono text-xs font-semibold"
                    >
                      <span>@{req.profile.handle}</span>
                      <span className="text-ink-muted">• Pending</span>
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* TAB 3: FIND PLAYERS & OPPONENTS */}
        {activeTab === 'find' && (
          <div className="space-y-6">
            {/* Search by Handle */}
            <section className="brutal-card p-5 sm:p-6">
              <h2 className="font-display text-2xl uppercase">Find by Handle</h2>
              <form onSubmit={findPlayer} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative">
                  <input
                    value={searchHandle}
                    onChange={(event) => setSearchHandle(event.target.value.toLowerCase())}
                    className="brutal-input text-sm pr-10"
                    placeholder="Enter player handle (e.g. shadow_player)"
                    autoComplete="off"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">
                      <Loader2 size={16} className="animate-spin text-ink" />
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isSearching || !searchHandle.trim()}
                  className="brutal-btn flex items-center justify-center gap-2 bg-caution-yellow text-ink"
                >
                  <Search size={16} strokeWidth={2.5} />
                  <span>{isSearching ? 'Searching...' : 'Find Player'}</span>
                </button>
              </form>
              <p className="mt-2 font-mono text-[11px] text-ink-muted">
                {searchHandle.trim().length === 0
                  ? 'Type 3 or more characters to search players automatically.'
                  : searchHandle.trim().length < 3
                  ? `Need ${3 - searchHandle.trim().length} more character${3 - searchHandle.trim().length === 1 ? '' : 's'}...`
                  : isSearching
                  ? 'Searching player records...'
                  : searchResult
                  ? 'Match found!'
                  : 'Press Enter or click Find Player to search.'}
              </p>

              {searchResult && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-paper p-3.5 shadow-[2px_2px_0_var(--color-ink)]">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-bold uppercase">
                      {searchResult.profile.displayName}{' '}
                      <span className="text-ink-muted">@{searchResult.profile.handle}</span>
                    </p>
                    <p className="font-mono text-xs text-ink-muted">
                      {searchResult.profile.gamesWon} wins from {searchResult.profile.gamesPlayed} matches
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setLocation(`/players/${searchResult.profile.handle}`)}
                      className="brutal-btn brutal-btn-compact text-xs bg-surface text-ink"
                    >
                      View Profile
                    </button>
                    {searchResult.friendshipState === 'none' ? (
                      <button
                        type="button"
                        onClick={() => void requestFriend(searchResult.profile.userId)}
                        className="brutal-btn brutal-btn-compact flex items-center gap-1 bg-confirmed-green text-xs text-white"
                      >
                        <UserPlus size={14} strokeWidth={2.5} />
                        <span>Add Friend</span>
                      </button>
                    ) : (
                      <span className="border border-ink bg-surface px-2 py-1 font-mono text-[11px] font-bold uppercase text-ink-muted">
                        {searchResult.friendshipState === 'friends'
                          ? 'Connected Friend'
                          : searchResult.friendshipState === 'outgoing'
                          ? 'Request Pending'
                          : searchResult.friendshipState === 'self'
                          ? 'You'
                          : 'Request Received'}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Recent Match Opponents */}
            <section className="brutal-card p-5 sm:p-6">
              <div className="mb-3 flex items-center gap-2 border-b-2 border-ink pb-2">
                <Users size={18} className="text-evidence-red" strokeWidth={2.5} />
                <h2 className="font-display text-xl uppercase">Recent Match Opponents</h2>
              </div>

              {recentPlayers.length === 0 ? (
                <p className="font-mono text-xs text-ink-muted">
                  No recent opponents recorded. Complete a multiplayer match with registered players to see them here.
                </p>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {recentPlayers.map((player) => {
                    const isFriend = acceptedFriends.some((f) => f.profile.userId === player.userId);
                    return (
                      <div
                        key={player.userId}
                        className="flex items-center justify-between border-2 border-ink bg-paper p-3 shadow-[2px_2px_0_var(--color-ink)]"
                      >
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setLocation(`/players/${player.handle}`)}
                            className="block truncate font-mono text-sm font-bold uppercase hover:underline"
                          >
                            @{player.handle}
                          </button>
                          <span className="font-mono text-[10px] text-ink-muted">
                            {player.gamesWon} wins • {calculateWinRate(player.gamesPlayed, player.gamesWon)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setLocation(`/players/${player.handle}`)}
                            className="brutal-btn brutal-btn-compact text-xs bg-surface text-ink"
                          >
                            Profile
                          </button>
                          {!isFriend && (
                            <button
                              type="button"
                              onClick={() => void requestFriend(player.userId)}
                              className="icon-btn h-8 w-8 bg-caution-yellow text-ink"
                              title="Add Friend"
                            >
                              <UserPlus size={15} strokeWidth={2.5} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        <section className="profile-signout mt-10 border-t-2 border-ink/20 pt-6 text-center">
          <p className="font-mono text-xs text-ink-muted">Finished managing your player account?</p>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="brutal-btn brutal-btn-compact mt-3 inline-flex items-center gap-1.5 bg-evidence-red text-xs text-white"
          >
            <LogOut size={15} strokeWidth={2.5} />
            <span>Sign Out</span>
          </button>
        </section>
      </main>
    </div>
  );
};
