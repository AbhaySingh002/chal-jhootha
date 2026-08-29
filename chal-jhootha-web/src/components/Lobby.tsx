import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Layers,
  Lock,
  Radio,
  Share2,
  Trophy,
  UserPlus,
  WifiOff,
  X,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useSession } from '../lib/auth';
import { createFriendRequest, getFriendships, type Friendship } from '../lib/profile';
import { useGameStore } from '../state/gameStore';
import { ThemeToggle } from './ThemeToggle';

export const Lobby: React.FC = () => {
  const { gameState, playerId, startGame, setConfig, resetSession } = useGameStore();
  const { data: session } = useSession();
  const [copied, setCopied] = useState(false);
  const [showFriendsDrawer, setShowFriendsDrawer] = useState(false);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [friendActionMsg, setFriendActionMsg] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const playerCount = gameState?.players.length ?? 0;
  const isHost = gameState?.hostId === playerId;
  const maxWinners = Math.max(1, playerCount - 1);
  const currentDeckCount = gameState?.deckCount || 1;
  const currentWinnerCount = gameState?.winnerCount || 1;
  const winnerCountLocked = gameState?.winnerCountLocked ?? false;
  const isRegistered = session?.user?.isRegistered === true;

  useEffect(() => {
    if (!winnerCountLocked && isHost && playerCount >= 2 && currentWinnerCount > maxWinners) {
      setConfig(currentDeckCount, maxWinners);
    }
  }, [winnerCountLocked, isHost, playerCount, currentWinnerCount, maxWinners, currentDeckCount, setConfig]);

  useEffect(() => {
    if (showFriendsDrawer && isRegistered) {
      getFriendships()
        .then((res) => {
          setFriends(res.friendships.filter((f) => f.direction === 'friend'));
        })
        .catch(() => {});
    }
  }, [showFriendsDrawer, isRegistered]);

  if (!gameState || gameState.phase !== 'lobby') return null;

  const inviteUrl = `${window.location.origin}/room/${gameState.roomCode}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy room link:', inviteUrl);
    }
  };

  const handleLeaveLobby = () => {
    resetSession();
    setLocation('/');
  };

  const handleAddFriend = async (targetUserId: string, playerName: string) => {
    try {
      await createFriendRequest(targetUserId);
      setFriendActionMsg(`Friend request sent to ${playerName}!`);
      setTimeout(() => setFriendActionMsg(null), 3000);
    } catch {
      setFriendActionMsg(`Could not send request.`);
      setTimeout(() => setFriendActionMsg(null), 3000);
    }
  };

  return (
    <div className="page-shell">
      {/* Top Header */}
      <header className="page-container mb-6 flex items-center justify-between gap-3 sm:mb-8">
        <button
          type="button"
          onClick={handleLeaveLobby}
          className="brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 bg-surface text-xs text-ink"
        >
          <ArrowLeft size={15} strokeWidth={2.5} />
          <span>Exit Room</span>
        </button>

        <div className="min-w-0 text-center">
          <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-ink-muted">
            ROOM CODE
          </span>
          <span className="font-display text-2xl tracking-[0.1em] text-ink">
            {gameState.roomCode}
          </span>
        </div>

        <ThemeToggle />
      </header>

      <main className="page-container grid items-start gap-6 pb-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
        {/* Main Seated Players Card */}
        <section className="brutal-card overflow-hidden">
          {/* Card Header Banner */}
          <div className="border-b-[3px] border-ink bg-ink p-4 text-paper sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="inline-block border border-caution-yellow bg-caution-yellow/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-caution-yellow">
                  LOBBY
                </span>
                <h1 className="mt-1 font-display text-2xl uppercase tracking-tight sm:text-3xl">
                  {playerCount} Seated Player{playerCount === 1 ? '' : 's'}
                </h1>
              </div>

              <div className="flex items-center gap-2">
                {isRegistered && (
                  <button
                    type="button"
                    onClick={() => setShowFriendsDrawer(true)}
                    className="brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 bg-surface text-xs text-ink"
                  >
                    <Share2 size={14} strokeWidth={2.5} />
                    <span>Invite Friends</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 bg-caution-yellow text-xs text-ink"
                >
                  {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2.5} />}
                  <span>{copied ? 'Copied' : 'Copy Invite'}</span>
                </button>
              </div>
            </div>
          </div>

          {friendActionMsg && (
            <div className="border-b-2 border-ink bg-confirmed-green p-2 text-center font-mono text-xs font-bold text-white">
              {friendActionMsg}
            </div>
          )}

          {/* Seated List */}
          <div className="p-4 sm:p-6">
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {gameState.players.map((player, index) => {
                const isYou = player.id === playerId;
                const canAddFriend =
                  isRegistered &&
                  player.userId &&
                  player.userId !== session?.user?.id;

                return (
                  <li
                    key={player.id}
                    className={`flex items-center justify-between border-2 border-ink p-3 shadow-[2px_2px_0_var(--color-ink)] ${
                      isYou ? 'bg-caution-yellow/20' : 'bg-paper'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-ink bg-surface font-display text-xs text-evidence-red">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-mono text-sm font-bold uppercase">{player.name}</p>
                          {isYou && (
                            <span className="border border-ink bg-caution-yellow px-1 font-mono text-[9px] font-bold">
                              YOU
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-ink-muted">
                          {player.isDisconnected ? 'Away' : 'Connected'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {player.id === gameState.hostId && (
                        <Crown size={17} className="text-caution-yellow" strokeWidth={2.5} aria-label="Host" />
                      )}
                      {player.isDisconnected && (
                        <WifiOff size={16} className="text-evidence-red" strokeWidth={2.5} aria-label="Away" />
                      )}
                      {canAddFriend && (
                        <button
                          type="button"
                          onClick={() => handleAddFriend(player.userId!, player.name)}
                          className="icon-btn h-7 w-7 bg-surface text-ink"
                          title="Add Friend"
                        >
                          <UserPlus size={13} strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Sidebar Controls */}
        <aside className="space-y-5">
          <section className="brutal-card p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2 border-b-2 border-ink pb-3">
              <Layers className="text-evidence-red" size={20} strokeWidth={2.5} />
              <h2 className="font-display text-xl uppercase">Match Settings</h2>
            </div>

            {playerCount < 2 ? (
              <div className="border-2 border-dashed border-ink bg-paper p-4 text-center">
                <div className="flex items-center justify-center gap-1.5 font-mono text-xs font-bold uppercase text-evidence-red">
                  <Radio size={15} strokeWidth={2.5} />
                  <span>Waiting for players</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-ink-muted">
                  Need at least 2 players to start. Share the invite link with friends.
                </p>
              </div>
            ) : isHost ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="deck-count" className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider">
                    Deck Count
                  </label>
                  <select
                    id="deck-count"
                    className="brutal-select text-sm"
                    value={currentDeckCount}
                    onChange={(event) => setConfig(Number(event.target.value), currentWinnerCount)}
                  >
                    <option value={1}>1 Deck (52 cards)</option>
                    <option value={2}>2 Decks (104 cards)</option>
                    <option value={3}>3 Decks (156 cards)</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor="winner-count" className="font-mono text-xs font-bold uppercase tracking-wider">
                      Target Winners
                    </label>
                    {winnerCountLocked ? (
                      <span className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase text-confirmed-green">
                        <Lock size={11} strokeWidth={2.5} />
                        <span>Locked</span>
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-ink-muted">1–{maxWinners}</span>
                    )}
                  </div>
                  <select
                    id="winner-count"
                    className="brutal-select text-sm disabled:opacity-55"
                    value={winnerCountLocked ? currentWinnerCount : Math.min(currentWinnerCount, maxWinners)}
                    disabled={winnerCountLocked}
                    onChange={(event) => setConfig(currentDeckCount, Number(event.target.value))}
                  >
                    {Array.from({ length: winnerCountLocked ? 1 : maxWinners }, (_, i) =>
                      winnerCountLocked ? currentWinnerCount : i + 1
                    ).map((w) => (
                      <option key={w} value={w}>
                        {w === 1 ? '1 Winner (First to empty)' : `${w} Winners (Top ${w})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="border-2 border-ink bg-paper p-2.5 text-center">
                  <span className="font-mono text-[10px] font-bold uppercase text-ink-muted">Decks</span>
                  <p className="mt-0.5 font-display text-xl">{currentDeckCount}</p>
                </div>
                <div className="border-2 border-ink bg-paper p-2.5 text-center">
                  <span className="font-mono text-[10px] font-bold uppercase text-ink-muted">Winners</span>
                  <p className="mt-0.5 font-display text-xl">{currentWinnerCount}</p>
                </div>
              </div>
            )}
          </section>

          {isHost ? (
            <button
              type="button"
              disabled={playerCount < 2}
              onClick={startGame}
              className="brutal-btn flex w-full items-center justify-center gap-2 bg-confirmed-green text-white transition-transform active:scale-[0.98]"
            >
              <Trophy size={18} strokeWidth={2.5} />
              <span>{playerCount < 2 ? 'Need 2+ Players' : `Start Match (${playerCount} Seated)`}</span>
            </button>
          ) : (
            <div className="border-2 border-ink bg-caution-yellow/40 p-3.5 text-center font-mono text-xs font-bold leading-5">
              Host will start the match once everyone is ready.
            </div>
          )}
        </aside>
      </main>

      {/* Friends Quick Invite Drawer / Modal */}
      {showFriendsDrawer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowFriendsDrawer(false);
          }}
        >
          <div className="brutal-card w-full max-w-md p-5 sm:p-6 shadow-[6px_6px_0_var(--color-ink)]">
            <div className="mb-4 flex items-center justify-between border-b-2 border-ink pb-2">
              <h3 className="font-display text-xl uppercase">Invite Connected Friends</h3>
              <button
                type="button"
                onClick={() => setShowFriendsDrawer(false)}
                className="icon-btn h-7 w-7"
              >
                <X size={15} strokeWidth={2.5} />
              </button>
            </div>

            {friends.length === 0 ? (
              <div className="py-6 text-center">
                <p className="font-mono text-xs text-ink-muted">No friends on your roster yet.</p>
                <p className="mt-1 font-mono text-[11px] text-ink-muted">
                  Search player handles in the Profile tab to add them.
                </p>
              </div>
            ) : (
              <ul className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {friends.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between border border-ink bg-paper p-2.5 font-mono text-xs font-bold"
                  >
                    <span>@{f.profile.handle}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(
                          `Hey! Join my Chal Jhootha game with code: ${gameState.roomCode}\n${inviteUrl}`
                        );
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="brutal-btn brutal-btn-compact text-[10px] bg-caution-yellow text-ink"
                    >
                      {copied ? 'Copied Link' : 'Copy Room Invite'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
