import { useEffect, useRef } from 'react';

type WsEventHandler = (event: { type: string; prdId?: string; data?: any; timestamp?: number }) => void;

const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

export function useWebSocket(prdId: string | undefined, onEvent: WsEventHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!prdId) return;

    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        ws.send(JSON.stringify({ type: 'subscribe', prdId }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'connected') {
            onEventRef.current(data);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        if (!cancelled) {
          // 1008 = Policy Violation (used by server for unauthorized connections)
          if (event.code === 1008) {
            return;
          }
          const delay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, attemptRef.current));
          const jitter = delay * (0.5 + Math.random() * 0.5);
          attemptRef.current++;
          reconnectTimer.current = setTimeout(connect, jitter);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      attemptRef.current = 0;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [prdId]);
}
