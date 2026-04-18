import React, { useEffect, useRef } from "react";
import { useChat, ConnectionState } from "../hooks/useChat";
import MessageBubble from "./MessageBubble";
import InputBar from "./InputBar";

interface ChatWindowProps {
  agentId: string;
  position: "bottom-right" | "bottom-left";
  primaryColor: string;
  onClose: () => void;
}

const statusLabel: Record<ConnectionState, string> = {
  connected: "Online",
  connecting: "Connecting...",
  disconnected: "Offline",
};

const ChatWindow: React.FC<ChatWindowProps> = ({
  agentId,
  position,
  primaryColor,
  onClose,
}) => {
  const { messages, sendMessage, connectionState, isTyping } = useChat({
    agentId,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = React.useState(false);

  // Auto-scroll on new messages or typing
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 200); // match animation duration
  };

  return (
    <div
      ref={windowRef}
      className={`va-chat-window ${position} ${closing ? "va-closing" : ""}`}
    >
      {/* Header */}
      <div className="va-header" style={{ backgroundColor: primaryColor }}>
        <div className="va-header-info">
          <div className="va-header-avatar">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.07A7 7 0 0 1 14 24h-4a7 7 0 0 1-6.93-6H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zm-2 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm4 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
            </svg>
          </div>
          <div className="va-header-text">
            <h3>AI Assistant</h3>
            <span>
              <span
                className={`va-status-dot ${connectionState}`}
              />
              {statusLabel[connectionState]}
            </span>
          </div>
        </div>
        <button
          className="va-close-btn"
          onClick={handleClose}
          aria-label="Close chat"
        >
          &#x2715;
        </button>
      </div>

      {/* Connection Banner */}
      {connectionState === "disconnected" && (
        <div className="va-connection-banner error">
          Connection lost. Reconnecting...
        </div>
      )}
      {connectionState === "connecting" && (
        <div className="va-connection-banner">Connecting to agent...</div>
      )}

      {/* Messages */}
      <div className="va-messages">
        {messages.length === 0 && (
          <div className="va-welcome-msg">
            <p>&#128075;</p>
            <p>
              Hi there! How can I help you today?
              <br />
              Type a message below to get started.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            primaryColor={primaryColor}
          />
        ))}
        {isTyping && (
          <div className="va-typing">
            <div className="va-typing-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <InputBar
        onSend={sendMessage}
        disabled={connectionState === "disconnected"}
        primaryColor={primaryColor}
      />
    </div>
  );
};

export default ChatWindow;
