import { useEffect, useRef, useCallback } from 'react';

interface WSMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

type MessageHandler = (msg: WSMessage) => void;

// Module-level singleton — shared across all usePatientWebSocket callers.
const listeners = new Map<string, Set<MessageHandler>>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function getPatientWSUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('patient_token');
  return `${proto}//${location.host}/api/v1/patient/ws?token=${token}`;
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  const token = localStorage.getItem('patient_token');
  if (!token) return;

  socket = new WebSocket(getPatientWSUrl());

  socket.onopen = () => {
    reconnectDelay = 1000;
    listeners.get('_reconnect')?.forEach(fn => fn({ type: '_reconnect', payload: null }));
  };

  socket.onmessage = (e) => {
    try {
      const msg: WSMessage = JSON.parse(e.data);
      listeners.get(msg.type)?.forEach(fn => fn(msg));
    } catch { /* ignore malformed messages */ }
  };

  socket.onclose = () => {
    socket = null;
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connect();
    }, reconnectDelay);
  };

  socket.onerror = () => { socket?.close(); };
}

function disconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  socket?.close();
  socket = null;
  reconnectDelay = 1000;
  listeners.clear();
}

/**
 * Patient-side WebSocket hook — uses patient_token from localStorage.
 * Connects to /api/v1/patient/ws and listens for server-pushed messages.
 */
export function usePatientWebSocket(type: string, handler: MessageHandler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback((msg: WSMessage) => {
    handlerRef.current(msg);
  }, []);

  useEffect(() => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(stableHandler);
    connect();

    return () => {
      const set = listeners.get(type);
      if (set) {
        set.delete(stableHandler);
        if (set.size === 0) listeners.delete(type);
      }
      let total = 0;
      listeners.forEach(s => (total += s.size));
      if (total === 0) disconnect();
    };
  }, [type, stableHandler]);
}
