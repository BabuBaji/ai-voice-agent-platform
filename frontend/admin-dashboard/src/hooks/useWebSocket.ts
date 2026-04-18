import { useEffect, useRef, useCallback } from 'react';
import { WS_URL } from '@/utils/constants';
import { useAuthStore } from '@/stores/auth.store';

type EventHandler = (data: unknown) => void;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, EventHandler[]>>(new Map());
  const token = useAuthStore((s) => s.accessToken);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_URL}?token=${token}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        const handlers = handlersRef.current.get(type);
        handlers?.forEach((handler) => handler(data));
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setTimeout(connect, 5000);
    };

    wsRef.current = ws;
  }, [token]);

  const subscribe = useCallback((event: string, handler: EventHandler) => {
    const existing = handlersRef.current.get(event) || [];
    handlersRef.current.set(event, [...existing, handler]);

    return () => {
      const handlers = handlersRef.current.get(event) || [];
      handlersRef.current.set(
        event,
        handlers.filter((h) => h !== handler)
      );
    };
  }, []);

  const send = useCallback((type: string, data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { connect, subscribe, send };
}
