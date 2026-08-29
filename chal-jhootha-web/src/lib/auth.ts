import { useEffect, useState } from 'react';
import { apiURL } from './api';

export type AuthUser = {
  id: string;
  name: string;
  email?: string;
  isRegistered: boolean;
  handle?: string;
  hasProfile: boolean;
};

const jsonHeaders = { 'Content-Type': 'application/json' };

async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }
  return data as { user?: AuthUser | null; activeRoomCode?: string; error?: string; ticket?: string; expiresIn?: number };
}

export async function ensureGuest(name?: string) {
  return parse(await fetch(apiURL('/api/auth/guest'), {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ name: name || 'GUEST' }),
  }));
}

export async function login(email: string, password: string) {
  return parse(await fetch(apiURL('/api/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  }));
}

export async function register(email: string, password: string, name: string, handle: string) {
  return parse(await fetch(apiURL('/api/auth/register'), {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password, name, handle }),
  }));
}

export async function fetchWsTicket() {
  const data = await parse(await fetch(apiURL('/api/auth/ws-ticket'), {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
  }));
  if (!data.ticket) {
    throw new Error('ticket failed');
  }
  return data.ticket;
}

export async function fetchSession() {
  return parse(await fetch(apiURL('/api/auth/session'), { credentials: 'include', cache: 'no-store' }));
}

export async function signOut() {
  await fetch(apiURL('/api/auth/logout'), { method: 'POST', credentials: 'include' });
}

export function useSession() {
  const [data, setData] = useState<{ user: AuthUser } | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    fetchSession()
      .then((s) => setData(s.user ? { user: s.user } : null))
      .catch(() => setData(null))
      .finally(() => setPending(false));
  }, []);

  return { data, isPending: pending };
}
