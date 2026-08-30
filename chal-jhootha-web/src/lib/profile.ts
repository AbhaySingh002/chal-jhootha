import { apiURL } from './api';
import { useState } from 'react';

export type FriendshipState = 'none' | 'self' | 'friends' | 'incoming' | 'outgoing';

export interface PlayerProfile {
  userId: string;
  handle: string;
  displayName: string;
  gamesPlayed: number;
  gamesWon: number;
  avatarId: string;
}

export function calculateWinRate(gamesPlayed: number, gamesWon: number): string {
  return gamesPlayed === 0 ? '0%' : `${Math.round((gamesWon / gamesPlayed) * 100)}%`;
}

export interface Friendship {
  id: string;
  status: 'pending' | 'accepted';
  direction: 'friend' | 'incoming' | 'outgoing';
  profile: PlayerProfile;
  online?: boolean;
}

export interface RoomInvite {
  token: string;
  roomCode: string;
  hostId: string;
  hostName: string;
  recipientId: string;
  expiresAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiURL(path), {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || 'Request failed');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getMyProfile() {
  return request<{ profile: PlayerProfile | null; requiresProfile: boolean }>('/api/profile/me');
}

export function createMyProfile(handle: string) {
  return request<{ profile: PlayerProfile }>('/api/profile/me', {
    method: 'POST',
    body: JSON.stringify({ handle }),
  });
}

export function updateMyProfile(handle: string, displayName: string, avatarId: string) {
  return request<{ profile: PlayerProfile }>('/api/profile/me', {
    method: 'PATCH',
    body: JSON.stringify({ handle, displayName, avatarId }),
  });
}

export function updateMyPassword(currentPassword: string, newPassword: string) {
  return request<{ ok: boolean }>('/api/profile/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function getPublicProfile(handle: string) {
  return request<{ profile: PlayerProfile; friendshipState: FriendshipState }>(`/api/profiles/${encodeURIComponent(handle)}`);
}

export function getFriendships() {
  return request<{ friendships: Friendship[] }>('/api/friends');
}

export function getRecentPlayers() {
  return request<{ players: PlayerProfile[] }>('/api/players/recent');
}

export function createFriendRequest(targetUserId: string) {
  return request<void>('/api/friends/requests', {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  });
}

export function respondToFriendRequest(id: string, accept: boolean) {
  return request<void>(`/api/friends/requests/${encodeURIComponent(id)}/${accept ? 'accept' : 'decline'}`, {
    method: 'POST',
  });
}

export function removeFriendship(id: string) {
  return request<void>(`/api/friends/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getRoomInvites() {
  return request<{ invites: RoomInvite[] }>('/api/room-invites');
}

export function createRoomInvite(roomCode: string, targetUserId: string) {
  return request<{ invite: RoomInvite }>('/api/room-invites', {
    method: 'POST',
    body: JSON.stringify({ roomCode, targetUserId }),
  });
}

export function respondToRoomInvite(token: string, accept: boolean) {
  return request<{ roomCode?: string }>(`/api/room-invites/${encodeURIComponent(token)}/${accept ? 'accept' : 'decline'}`, {
    method: 'POST',
  });
}

export function useFriendRequest() {
  const [error, setError] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);

  const requestFriend = async (targetUserId: string, onSuccess?: () => void) => {
    setIsRequesting(true);
    setError('');
    try {
      await createFriendRequest(targetUserId);
      onSuccess?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send friend request.');
    } finally {
      setIsRequesting(false);
    }
  };

  return { requestFriend, error, isRequesting, setError };
}
