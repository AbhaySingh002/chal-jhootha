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
const reliableActionTypes = new Set(['start_game', 'reset_to_lobby', 'return_to_lobby', 'set_config', 'play_cards', 'challenge', 'skip', 'leave_room', 'destroy_room']);
const pendingReliableEvents = new Map<string, ClientEvent>();

function isReliableAction(event: ClientEvent) {
  return reliableActionTypes.has(event.type);
}

function queueReliableEventsForRetry() {
  for (const event of pendingReliableEvents.values()) {
    if (!messageQueue.some((queued) => queued.clientMsgId === event.clientMsgId)) {
      messageQueue.push(event);
    }
  }
}

function resolveReliableEvent(event: ServerEvent) {
  if (event.type === 'action_accepted' || event.type === 'action_rejected') {
    pendingReliableEvents.delete(event.clientMsgId);
  } else if (event.type === 'error' && event.clientMsgId) {
    pendingReliableEvents.delete(event.clientMsgId);
  }
}

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

    // Keep the one-time ticket out of URLs so reverse-proxy and browser URL
    // logs cannot retain it. `cj-v1` is the negotiated application protocol;
    // the second value is read only during the handshake.
    socket = new WebSocket(url, ['cj-v1', `cj-auth-${ticket}`]);

    socket.onopen = () => {
      reconnectAttempts = 0;
      useGameStore.getState().onConnected();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      const joinMsgIndex = messageQueue.map(m => m.type).lastIndexOf('join_room');
      if (joinMsgIndex !== -1) {
        const joinMessage = messageQueue[joinMsgIndex];
        messageQueue = [joinMessage, ...messageQueue.filter((m, i) => m.type !== 'join_room' && i !== joinMsgIndex)];
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
        if (data.type === 'room_invite') {
          window.dispatchEvent(new CustomEvent('cj:room_invite', { detail: data }));
          return;
        }
        useGameStore.getState().onMessage(data);
        resolveReliableEvent(data);
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    };

    socket.onclose = () => {
      useGameStore.getState().onDisconnected();
      queueReliableEventsForRetry();
      socket = null;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      const playerId = sessionStorage.getItem('playerId');
      const roomCode = sessionStorage.getItem('roomCode');
      if (playerId && roomCode) {
        const delay = Math.min(500 * Math.pow(2, reconnectAttempts), 5000) * (0.5 + Math.random());
        reconnectAttempts++;
        useGameStore.getState().setConnectionStatus('RECONNECTING');
        reconnectTimer = setTimeout(() => {
          messageQueue.push({
            type: 'join_room',
            roomCode,
            playerName: '',
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
  if (isReliableAction(event)) {
    pendingReliableEvents.set(event.clientMsgId, event);
  }
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
      const playerId = sessionStorage.getItem('playerId');
      const roomCode = sessionStorage.getItem('roomCode');
      if (playerId && roomCode) void connectSocket();
    }
  });
}
