export type FriendshipState = 'none' | 'self' | 'friends' | 'incoming' | 'outgoing';

export interface PlayerProfile {
  userId: string;
  handle: string;
  displayName: string;
  gamesPlayed: number;
  gamesWon: number;
}

export interface Friendship {
  id: string;
  status: 'pending' | 'accepted';
  direction: 'friend' | 'incoming' | 'outgoing';
  profile: PlayerProfile;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiURL(path), {
    credentials: 'include',
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

export function updateMyProfile(handle: string, displayName: string) {
  return request<{ profile: PlayerProfile }>('/api/profile/me', {
    method: 'PATCH',
    body: JSON.stringify({ handle, displayName }),
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
import { apiURL } from './api';
