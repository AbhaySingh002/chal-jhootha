import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
import { useSession } from '../lib/auth';
import { createFriendRequest, createRoomInvite, getFriendships, type Friendship } from '../lib/profile';
import { useGameStore } from '../state/gameStore';
import { ThemeToggle } from './ThemeToggle';

interface LobbyProps {
  completedMatch?: boolean;
}

export const Lobby: React.FC<LobbyProps> = ({ completedMatch = false }) => {
  const { gameState, playerId, startGame, setConfig, leaveRoom, destroyRoom, youAreController } = useGameStore();
  const { data: session } = useSession();
  const [copied, setCopied] = useState(false);
  const [showFriendsDrawer, setShowFriendsDrawer] = useState(false);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [friendActionMsg, setFriendActionMsg] = useState<string | null>(null);
  const [friendRequestStatus, setFriendRequestStatus] = useState<Record<string, 'sent' | 'failed'>>({});

  const playerCount = gameState?.players.length ?? 0;
  const isHost = gameState?.hostId === playerId && youAreController;
  const maxWinners = Math.max(1, playerCount - 1);
  const currentDeckCount = gameState?.deckCount || 1;
  const currentWinnerCount = gameState?.winnerCount || 1;
  const winnerCountLocked = gameState?.winnerCountLocked ?? false;
  const rosterNeedsScroll = playerCount > 4;
  const isRegistered = session?.user?.isRegistered === true;
  const lastMatchNames = (gameState?.lastMatch?.winnerIds ?? []).map((winnerID) => gameState?.players.find((player) => player.id === winnerID)?.name || 'Unknown');
  const requiredReturnees = (gameState?.players ?? []).filter((player) => !player.isDisconnected && !player.isAbandoned);
  const returnedPlayerIDs = new Set(gameState?.resultsLobbyPlayerIds ?? []);
  const missingReturnees = requiredReturnees.filter((player) => !returnedPlayerIDs.has(player.id));
  const resultsLobbyReady = missingReturnees.length === 0;

  useEffect(() => {
    if (!completedMatch && !winnerCountLocked && isHost && playerCount >= 2 && currentWinnerCount > maxWinners) {
      setConfig(currentDeckCount, maxWinners);
    }
  }, [completedMatch, winnerCountLocked, isHost, playerCount, currentWinnerCount, maxWinners, currentDeckCount, setConfig]);

  useEffect(() => {
    if (showFriendsDrawer && isRegistered) {
      getFriendships()
        .then((res) => {
          const accepted = res.friendships.filter((f) => f.direction === 'friend');
          // Online friends first, then alphabetical by handle
          accepted.sort((a, b) => {
            if (a.online && !b.online) return -1;
            if (!a.online && b.online) return 1;
            return a.profile.handle.localeCompare(b.profile.handle);
          });
          setFriends(accepted);
        })
        .catch(() => {});
    }
  }, [showFriendsDrawer, isRegistered]);

  if (!gameState || (gameState.phase !== 'lobby' && !completedMatch)) return null;

  const inviteUrl = `${window.location.origin}/room/${gameState.roomCode}`;
  const showMessage = (message: string) => {
    setFriendActionMsg(message);
    window.setTimeout(() => setFriendActionMsg(null), 3000);
  };

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(gameState.roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy room code:', gameState.roomCode);
    }
  };

  const shareInviteLink = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Join my Chal Jhootha room',
          text: `Join my room with code ${gameState.roomCode}.`,
          url: inviteUrl,
        });
        showMessage('Invite shared.');
        return;
      }
      await navigator.clipboard.writeText(inviteUrl);
      showMessage('Invite link copied for sharing.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      window.prompt('Share this room link:', inviteUrl);
    }
  };

  const openInviteOptions = () => {
    if (isRegistered) {
      setShowFriendsDrawer(true);
      return;
    }
    void shareInviteLink();
  };

  const handleLeaveLobby = () => {
    leaveRoom();
  };

  const handleInviteFriend = async (targetUserId: string, playerName: string) => {
    try {
      if (!gameState) return;
      await createRoomInvite(gameState.roomCode, targetUserId);
      showMessage(`Live invite sent to ${playerName}!`);
    } catch {
      showMessage('Could not send invite. They may be offline or in another room.');
    }
  };

  const handleFriendRequest = async (targetUserId: string) => {
    try {
      await createFriendRequest(targetUserId);
      setFriendRequestStatus((current) => ({ ...current, [targetUserId]: 'sent' }));
      showMessage('Friend request sent.');
    } catch {
      setFriendRequestStatus((current) => ({ ...current, [targetUserId]: 'failed' }));
      showMessage('Could not send that friend request.');
    }
  };

  return (
    <div className="page-shell lobby-shell">
      {/* Top Header */}
      <header className="lobby-header page-container mb-6 sm:mb-8">
        <button
          type="button"
          onClick={handleLeaveLobby}
          className="lobby-header-exit brutal-btn brutal-btn-compact inline-flex items-center gap-1.5 bg-surface text-xs text-ink"
        >
          <ArrowLeft size={15} strokeWidth={2.5} />
          <span>Exit Room</span>
        </button>

        {isHost && !completedMatch ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Destroy this room for every player?')) destroyRoom();
            }}
            className="lobby-header-destroy brutal-btn brutal-btn-compact bg-evidence-red text-xs text-white"
          >
            Destroy
          </button>
        ) : null}

        <ThemeToggle className="lobby-header-theme" />
      </header>

      <main className="lobby-main page-container grid items-start gap-6 pb-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
        {/* Main Seated Players Card */}
        <section className="lobby-roster-card brutal-card overflow-hidden">
          {/* Card Header Banner */}
          <div className="lobby-roster-header border-b-[3px] border-ink bg-ink p-4 text-paper sm:p-6">
            <div className="lobby-roster-banner">
              <div className="lobby-roster-title">
                <span className="inline-block border border-caution-yellow bg-caution-yellow/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-caution-yellow">
                  LOBBY
                </span>
                <h1 className="mt-1 font-display text-2xl uppercase tracking-tight sm:text-3xl">
                  {playerCount} Seated Player{playerCount === 1 ? '' : 's'}
                </h1>
              </div>

              <div className="lobby-action-group flex flex-wrap items-center gap-2 sm:gap-2.5" role="group" aria-label={`Room ${gameState.roomCode}`}>
                <div
                  className="lobby-code-badge flex h-10 sm:h-11 items-center justify-center rounded-lg border-2 border-ink bg-surface px-3.5 font-mono shadow-[2px_2px_0_var(--color-ink)] select-all"
                  title="Room Code"
                >
                  <span className="text-sm sm:text-base font-black tracking-[0.2em] text-ink">{gameState.roomCode}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void copyRoomCode()}
                  className="brutal-btn brutal-btn-compact inline-flex h-10 sm:h-11 items-center gap-1.5 rounded-lg border-2 border-ink bg-caution-yellow px-3 text-xs font-bold uppercase tracking-wider text-ink shadow-[2px_2px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                  aria-label={copied ? 'Room code copied' : `Copy room code ${gameState.roomCode}`}
                  title={copied ? 'Room code copied' : 'Copy room code'}
                >
                  {copied ? <Check size={14} strokeWidth={2.5} className="text-confirmed-green" /> : <Copy size={14} strokeWidth={2.5} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                {!completedMatch && (
                  <button
                    type="button"
                    onClick={openInviteOptions}
                    className="brutal-btn brutal-btn-compact inline-flex h-10 sm:h-11 items-center gap-1.5 rounded-lg border-2 border-ink bg-surface px-3.5 text-xs font-bold uppercase tracking-wider text-ink shadow-[2px_2px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                    aria-label="Invite players"
                  >
                    <Share2 size={14} strokeWidth={2.5} />
                    <span>Invite</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {friendActionMsg && (
            <div className="border-b-2 border-ink bg-confirmed-green p-2 text-center font-mono text-xs font-bold text-white">
              {friendActionMsg}
            </div>
          )}

          {lastMatchNames.length > 0 && (
            <div className="border-b-2 border-ink bg-caution-yellow/25 px-4 py-2 text-center font-mono text-xs font-bold uppercase sm:px-6">
              Last match · {lastMatchNames.join(', ')} {lastMatchNames.length === 1 ? 'won' : 'placed'}
            </div>
          )}

          {/* Seated List */}
          <div className={`lobby-roster-list p-4 sm:p-6 ${rosterNeedsScroll ? 'lobby-roster-list--scroll' : ''}`}>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {gameState.players.map((player, index) => {
                const isYou = player.id === playerId;
                const targetUserId = player.userId && player.userId !== session?.user?.id ? player.userId : null;
                const requestState = targetUserId ? friendRequestStatus[targetUserId] : undefined;
                return (
                  <li
                    key={player.id}
                    className={`lobby-player-row border-2 border-ink p-3 shadow-[2px_2px_0_var(--color-ink)] ${
                      isYou ? 'bg-caution-yellow/20' : 'bg-paper'
                    }`}
                  >
                    <div className="lobby-player-identity">
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

                    <div className="lobby-player-actions">
                      {targetUserId && (
                        <button
                          type="button"
                          disabled={!isRegistered || requestState === 'sent'}
                          onClick={() => void handleFriendRequest(targetUserId)}
                          className="icon-btn h-11 w-11 border-2 bg-surface text-ink disabled:opacity-45"
                          aria-label={
                            !isRegistered
                              ? 'Sign in to add this player as a friend'
                              : requestState === 'sent'
                              ? 'Friend request sent'
                              : requestState === 'failed'
                              ? 'Retry friend request'
                              : `Add ${player.name} as a friend`
                          }
                          title={!isRegistered ? 'Sign in to add friends' : requestState === 'sent' ? 'Friend request sent' : 'Add friend'}
                        >
                          {requestState === 'sent' ? <Check size={17} strokeWidth={2.5} /> : <UserPlus size={17} strokeWidth={2.5} />}
                        </button>
                      )}
                      {player.id === gameState.hostId && (
                        <span className="lobby-player-indicator text-caution-yellow" title="Host">
                          <Crown size={17} strokeWidth={2.5} aria-label="Host" />
                        </span>
                      )}
                      {player.isDisconnected && (
                        <span className="lobby-player-indicator text-evidence-red" title="Away">
                          <WifiOff size={16} strokeWidth={2.5} aria-label="Away" />
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Sidebar Controls */}
        <aside className="lobby-settings space-y-5">
          <section className="lobby-settings-card brutal-card p-5 sm:p-6">
            <div className="lobby-settings-heading mb-4 flex items-center gap-2 border-b-2 border-ink pb-3">
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
                  Need at least 2 players to start. Share the code with friends.
                </p>
              </div>
            ) : isHost ? (
              <div className="lobby-config-fields space-y-4">
                <div>
                  <label htmlFor="deck-count" className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider">
                    Deck Count
                  </label>
                  <select
                    id="deck-count"
                    className="brutal-select text-sm"
                    value={currentDeckCount}
                    disabled={completedMatch}
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
                    disabled={winnerCountLocked || completedMatch}
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
            <div className="space-y-2.5">
              {completedMatch && !resultsLobbyReady ? (
                <p className="border-2 border-ink bg-caution-yellow/40 p-3 text-center font-mono text-xs font-bold leading-5">
                  Waiting for {missingReturnees.length} player{missingReturnees.length === 1 ? '' : 's'} to return to the lobby.
                </p>
              ) : null}
              <button
                type="button"
                disabled={playerCount < 2 || (completedMatch && !resultsLobbyReady)}
                onClick={startGame}
                className="lobby-start-action brutal-btn flex w-full items-center justify-center gap-2 bg-confirmed-green text-white transition-transform active:scale-[0.98]"
              >
                <Trophy size={18} strokeWidth={2.5} />
                <span>{playerCount < 2 ? 'Need 2+ Players' : `Start Match (${playerCount} Seated)`}</span>
              </button>
            </div>
          ) : (
            <div className="border-2 border-ink bg-caution-yellow/40 p-3.5 text-center font-mono text-xs font-bold leading-5">
              {completedMatch ? 'Waiting for the host to start the next match.' : 'Host will start the match once everyone is ready.'}
            </div>
          )}
        </aside>
      </main>

      {/* Friends Quick Invite Drawer */}
      <AnimatePresence>
        {showFriendsDrawer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="lobby-modal-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/60"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowFriendsDrawer(false);
            }}
          >
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="lobby-invite-drawer brutal-card w-full max-w-md sm:m-4 shadow-[6px_6px_0_var(--color-ink)] flex flex-col" style={{ maxHeight: '80dvh' }}>
              {/* Drawer header */}
              <div className="flex items-center justify-between border-b-2 border-ink p-4 sm:p-5">
                <div>
                  <h3 className="font-display text-lg uppercase">Invite Friends</h3>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-muted">
                    {friends.filter((f) => f.online).length} online · {friends.length} total
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFriendsDrawer(false)}
                  className="icon-btn h-10 w-10"
                  aria-label="Close"
                >
                  <X size={15} strokeWidth={2.5} />
                </button>
              </div>

              {/* Friends list */}
              <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
                {friends.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="font-mono text-xs text-ink-muted">No friends on your roster yet.</p>
                    <p className="mt-1 font-mono text-[10px] text-ink-muted">
                      Add players from the Profile tab.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {friends.map((f) => (
                      <li
                        key={f.id}
                        className={`flex items-center justify-between border-2 border-ink p-2.5 transition-opacity ${
                          f.online ? 'bg-paper' : 'bg-surface opacity-55'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <span
                            className={`relative flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full ${
                              f.online ? 'bg-confirmed-green' : 'bg-ink/20'
                            }`}
                            aria-label={f.online ? 'Online' : 'Offline'}
                          >
                            {f.online && (
                              <span className="absolute inset-0 animate-ping rounded-full bg-confirmed-green opacity-40" />
                            )}
                          </span>
                          <span className="truncate font-mono text-xs font-bold">@{f.profile.handle}</span>
                        </span>
                        <button
                          type="button"
                          disabled={!f.online}
                          onClick={() => void handleInviteFriend(f.profile.userId, f.profile.displayName)}
                          className={`brutal-btn brutal-btn-compact shrink-0 text-[10px] ${
                            f.online
                              ? 'bg-caution-yellow text-ink'
                              : 'cursor-not-allowed bg-surface text-ink-muted'
                          }`}
                        >
                          {f.online ? 'Invite' : 'Offline'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Footer: share link fallback */}
              <div className="border-t-2 border-ink p-3 sm:p-4">
                <button
                  type="button"
                  onClick={() => void shareInviteLink()}
                  className="brutal-btn brutal-btn-compact inline-flex w-full items-center justify-center gap-1.5 bg-surface text-xs text-ink"
                >
                  <Share2 size={14} strokeWidth={2.5} />
                  <span>Share room link instead</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
