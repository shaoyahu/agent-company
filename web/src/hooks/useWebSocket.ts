import { useEffect, useRef, useState } from 'react';
import {
  parseWebSocketData,
  type SocketEvent,
} from '../features/messages/conversationEvents';
import { wsUrl } from '../runtime/runtimeConfig';

export function useWebSocket() {
  const [lastEvent, setLastEvent] = useState<SocketEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl('/ws'));
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        setConnectionGeneration((current) => current + 1);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) {
          reconnectTimer = window.setTimeout(connect, 1_000);
        }
      };
      ws.onmessage = (event) => {
        const parsed = parseWebSocketData(event.data);
        if (parsed) setLastEvent(parsed);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      wsRef.current?.close();
    };
  }, []);

  return { lastEvent, connected, connectionGeneration, ws: wsRef };
}
