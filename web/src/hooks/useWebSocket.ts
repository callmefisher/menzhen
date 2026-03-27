import { useEffect, useRef, useCallback } from 'react';

interface WSMessage {
  type: string;
  payload: any;
}

type MessageHandler = (msg: WSMessage) => void;

const listeners = new Map<string, Set<MessageHandler>>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function getWSUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  return `${proto}//${location.host}/api/v1/ws?token=${token}`;
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (!token) return;

  socket = new WebSocket(getWSUrl());

  socket.onopen = () => {
    reconnectDelay = 1000;
    // Notify all listeners to refetch (DB is truth source)
    listeners.get('_reconnect')?.forEach(fn => fn({ type: '_reconnect', payload: null }));
  };

  socket.onmessage = (e) => {
    try {
      const msg: WSMessage = JSON.parse(e.data);
      console.log('[WebSocket] Received message:', msg.type, msg.payload);
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

  socket.onerror = () => {
    socket?.close();
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
}

/**
 * Public WebSocket hook — reusable for prescription notifications, appointment queues, etc.
 * @param type Message type to listen for (rx_notify, rx_done, rx_cleanup, _reconnect)
 * @param handler Callback when message of this type arrives
 */
export function useWebSocket(type: string, handler: MessageHandler) {
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
      listeners.get(type)?.delete(stableHandler);
      // Disconnect when no listeners remain
      let total = 0;
      listeners.forEach(s => (total += s.size));
      if (total === 0) disconnect();
    };
  }, [type, stableHandler]);
}
