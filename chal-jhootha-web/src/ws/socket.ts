import type { ClientEvent, ServerEvent } from 'shared';
import { useGameStore } from '../state/gameStore';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let messageQueue: ClientEvent[] = [];
let reconnectAttempts = 0;

function wsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL as string;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connectSocket(url = wsUrl()) {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  useGameStore.getState().setConnectionStatus('CONNECTING');
  socket = new WebSocket(url);

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
        });
        connectSocket(url);
      }, delay);
    } else {
      useGameStore.getState().setConnectionStatus('OFFLINE');
    }
  };
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
      if (rejoinToken && roomCode) connectSocket();
    }
  });
}
