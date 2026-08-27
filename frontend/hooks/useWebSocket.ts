"use client";

import { useEffect, useRef, useState } from "react";
import { WS_BASE } from "../lib/api";

interface WSMessage {
  type: string;
  [key: string]: unknown;
}

export type WSState = "connecting" | "live" | "reconnecting" | "offline";

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 15000;
const STALE_AFTER_MS = 45000;

function backoffDelay(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return exp + Math.floor(Math.random() * 300);
}

export function useWebSocket(channel: string, onMessage?: (msg: WSMessage) => void) {
  const [messages, setMessages] = useState<WSMessage[]>([]);
  const [state, setState] = useState<WSState>("connecting");
  const [attempt, setAttempt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const lastActivityRef = useRef<number>(0);
  const closedBySelfRef = useRef(false);
  const attemptRef = useRef(0);
  const channelRef = useRef(channel);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let heartbeat: number | null = null;
    let reconnectTimeout: number | null = null;

    const clearTimers = () => {
      if (heartbeat) window.clearInterval(heartbeat);
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
      heartbeat = null;
      reconnectTimeout = null;
    };

    const openSocket = () => {
      const ws = new WebSocket(`${WS_BASE}/api/ws/${channelRef.current}`);
      socket = ws;
      wsRef.current = ws;
      setState("connecting");

      ws.onopen = () => {
        setState("live");
        attemptRef.current = 0;
        setAttempt(0);
        lastActivityRef.current = Date.now();
        clearTimers();
        heartbeat = window.setInterval(() => {
          const now = Date.now();
          if (now - lastActivityRef.current > STALE_AFTER_MS) {
            try {
              ws.close();
            } catch {
              /* noop */
            }
            return;
          }
          try {
            ws.send(JSON.stringify({ type: "ping", t: now }));
          } catch {
            /* socket likely gone; close will trigger reconnect */
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        lastActivityRef.current = Date.now();
        try {
          const data: WSMessage = JSON.parse(event.data);
          if (data && data.type === "pong") return;
          setMessages((prev) => [data, ...prev].slice(0, 100));
          onMessageRef.current?.(data);
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      };

      ws.onclose = () => {
        clearTimers();
        if (closedBySelfRef.current) return;
        setState("reconnecting");
        const delay = backoffDelay(attemptRef.current);
        attemptRef.current += 1;
        setAttempt(attemptRef.current);
        reconnectTimeout = window.setTimeout(() => {
          if (!closedBySelfRef.current) openSocket();
        }, delay);
      };
    };

    closedBySelfRef.current = false;
    attemptRef.current = 0;
    openSocket();

    return () => {
      closedBySelfRef.current = true;
      clearTimers();
      if (socket) {
        try {
          socket.close();
        } catch {
          /* noop */
        }
      }
      wsRef.current = null;
    };
  }, [channel]);

  return { messages, state, connected: state === "live", attempt };
}
