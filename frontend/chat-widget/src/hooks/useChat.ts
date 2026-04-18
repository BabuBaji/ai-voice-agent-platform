import { useState, useEffect, useRef, useCallback } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export type ConnectionState = "connecting" | "connected" | "disconnected";

interface UseChatOptions {
  agentId: string;
  wsUrl?: string;
}

const DEFAULT_WS_URL = "ws://localhost:8000/ws/chat";
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]; // exponential backoff

export function useChat({ agentId, wsUrl }: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [isTyping, setIsTyping] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(true);

  const generateId = () =>
    `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = `${wsUrl || DEFAULT_WS_URL}/${agentId}`;
    setConnectionState("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnectionState("connected");
        reconnectAttempt.current = 0;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);

          if (data.type === "typing") {
            setIsTyping(true);
            return;
          }

          if (data.type === "message" || data.type === "response") {
            setIsTyping(false);
            const msg: Message = {
              id: data.id || generateId(),
              role: "assistant",
              content: data.content || data.message || "",
              timestamp: data.timestamp || Date.now(),
            };
            setMessages((prev) => [...prev, msg]);
          }

          if (data.type === "error") {
            setIsTyping(false);
            const msg: Message = {
              id: generateId(),
              role: "assistant",
              content: `Error: ${data.message || "Something went wrong."}`,
              timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, msg]);
          }
        } catch {
          // Handle plain text responses
          setIsTyping(false);
          const msg: Message = {
            id: generateId(),
            role: "assistant",
            content: event.data,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, msg]);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnectionState("disconnected");
        setIsTyping(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        ws.close();
      };
    } catch {
      setConnectionState("disconnected");
      scheduleReconnect();
    }
  }, [agentId, wsUrl]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    const delay =
      RECONNECT_DELAYS[
        Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)
      ];
    reconnectAttempt.current += 1;
    reconnectTimer.current = setTimeout(() => {
      if (mountedRef.current) connect();
    }, delay);
  }, [connect]);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const msg: Message = {
        id: generateId(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, msg]);
      setIsTyping(true);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "message",
            content: trimmed,
            agentId,
          })
        );
      } else {
        // Queue failed - show error
        setIsTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "assistant",
            content: "Unable to send message. Connection lost. Reconnecting...",
            timestamp: Date.now(),
          },
        ]);
        connect();
      }
    },
    [agentId, connect]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    messages,
    sendMessage,
    clearMessages,
    connectionState,
    isTyping,
  };
}
