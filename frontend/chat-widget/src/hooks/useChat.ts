import { useCallback, useEffect, useRef, useState } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/**
 * Connection state semantics for the embeddable widget.
 * `connected` = the public chat endpoint reachable on last try.
 * `connecting` = a request is currently in flight.
 * `disconnected` = the last request failed.
 */
export type ConnectionState = "connecting" | "connected" | "disconnected";

interface UseChatOptions {
  agentId: string;
  /** Public chat endpoint base URL — points to ai-runtime, e.g. `https://yourdomain.com:8000`. */
  apiUrl?: string;
  /** Optional visitor identifier to thread sessions across page loads. */
  visitorId?: string;
}

const DEFAULT_API_URL =
  // Same-origin if served from the customer site, otherwise localhost dev default.
  typeof window !== "undefined" && window.location?.origin && !window.location.origin.startsWith("file:")
    ? window.location.origin
    : "http://localhost:8000";

const STORAGE_KEY = "va_widget_conv";

function genId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadConversationId(agentId: string): string | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${agentId}`);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function saveConversationId(agentId: string, convId: string): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${agentId}`, convId);
  } catch {
    /* third-party storage may be blocked — fine, conversation just won't persist across reloads */
  }
}

export function useChat({ agentId, apiUrl, visitorId }: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connected");
  const [isTyping, setIsTyping] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const baseUrl = (apiUrl || DEFAULT_API_URL).replace(/\/$/, "");

  // Hydrate any persisted conversation id so multi-message chats survive reloads.
  useEffect(() => {
    conversationIdRef.current = loadConversationId(agentId);
  }, [agentId]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const userMsg: Message = {
        id: genId(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      setConnectionState("connecting");

      try {
        const resp = await fetch(`${baseUrl}/chat/widget`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            message: trimmed,
            conversation_id: conversationIdRef.current || undefined,
            visitor_id: visitorId || undefined,
          }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200) || resp.statusText}`);
        }

        const data: { conversation_id: string; reply: string; used_mock: boolean } = await resp.json();
        if (data.conversation_id && conversationIdRef.current !== data.conversation_id) {
          conversationIdRef.current = data.conversation_id;
          saveConversationId(agentId, data.conversation_id);
        }

        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: "assistant",
            content: data.reply || "(no reply)",
            timestamp: Date.now(),
          },
        ]);
        setConnectionState("connected");
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: "assistant",
            content: `Sorry, I couldn't reach the server right now. (${err?.message || "network error"})`,
            timestamp: Date.now(),
          },
        ]);
        setConnectionState("disconnected");
      } finally {
        setIsTyping(false);
      }
    },
    [agentId, baseUrl, visitorId],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    conversationIdRef.current = null;
    try {
      localStorage.removeItem(`${STORAGE_KEY}:${agentId}`);
    } catch {
      /* noop */
    }
  }, [agentId]);

  return {
    messages,
    sendMessage,
    clearMessages,
    connectionState,
    isTyping,
  };
}
