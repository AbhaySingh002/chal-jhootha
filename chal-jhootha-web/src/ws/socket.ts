import type { ClientEvent, ServerEvent } from 'shared';
import { fetchWsTicket } from '../lib/auth';
import { PROTOCOL_VERSION } from 'shared';
import { useGameStore } from '../state/gameStore';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let messageQueue: ClientEvent[] = [];
let reconnectAttempts = 0;
let connectLock: Promise<void> | null = null;

function wsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL as string;
  if (import.meta.env.VITE_API_ORIGIN) {
    const api = new URL(import.meta.env.VITE_API_ORIGIN as string);
    const proto = api.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${api.host}/ws`;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function withWsTicket(baseUrl: string, ticket: string) {
  const parsed = new URL(baseUrl, typeof location !== 'undefined' ? location.href : 'http://localhost');
  parsed.searchParams.delete('ticket');
  parsed.searchParams.set('ticket', ticket);
  return parsed.toString();
}

export async function connectSocket(url = wsUrl()) {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }
  if (connectLock) {
    await connectLock;
    return;
  }

  connectLock = (async () => {
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    useGameStore.getState().setConnectionStatus('CONNECTING');
    let ticket: string;
    try {
      ticket = await fetchWsTicket();
    } catch {
      useGameStore.getState().setConnectionStatus('OFFLINE');
      return;
    }

    socket = new WebSocket(withWsTicket(url, ticket));

    socket.onopen = () => {
      reconnectAttempts = 0;
      useGameStore.getState().onConnected();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      const joinMsgIndex = messageQueue.map(m => m.type).lastIndexOf('join_room');
      if (joinMsgIndex !== -1) {
        messageQueue = messageQueue.filter((m, i) => m.type !== 'join_room' || i === joinMsgIndex);
      }

      while (messageQueue.length > 0) {
        const msg = messageQueue.shift();
        if (msg && socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      }

      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        sendEvent({ type: 'heartbeat', clientMsgId: crypto.randomUUID() });
      }, 15000);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent;
        useGameStore.getState().onMessage(data);
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    };

    socket.onclose = () => {
      useGameStore.getState().onDisconnected();
      socket = null;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      const rejoinToken = sessionStorage.getItem('rejoinToken');
      const roomCode = sessionStorage.getItem('roomCode');
      if (rejoinToken && roomCode) {
        const delay = Math.min(500 * Math.pow(2, reconnectAttempts), 5000) * (0.5 + Math.random());
        reconnectAttempts++;
        useGameStore.getState().setConnectionStatus('RECONNECTING');
        reconnectTimer = setTimeout(() => {
          messageQueue.push({
            type: 'join_room',
            roomCode,
            playerName: '',
            rejoinToken,
            clientMsgId: crypto.randomUUID(),
            protocolVersion: PROTOCOL_VERSION,
          });
          void connectSocket();
        }, delay);
      } else {
        useGameStore.getState().setConnectionStatus('OFFLINE');
      }
    };
  })();

  try {
    await connectLock;
  } finally {
    connectLock = null;
  }
}

export function sendEvent(event: ClientEvent) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  } else {
    messageQueue.push(event);
  }
}

export function disconnectSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!socket || socket.readyState !== WebSocket.OPEN)) {
      const rejoinToken = sessionStorage.getItem('rejoinToken');
      const roomCode = sessionStorage.getItem('roomCode');
      if (rejoinToken && roomCode) void connectSocket();
    }
  });
}
