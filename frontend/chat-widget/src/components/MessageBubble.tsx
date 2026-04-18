import React from "react";
import type { Message } from "../hooks/useChat";

interface MessageBubbleProps {
  message: Message;
  primaryColor: string;
}

/** Simple markdown-like formatting: **bold** and [text](url) */
function formatContent(content: string): React.ReactNode[] {
  // Split on bold and link patterns
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Bold
      parts.push(<strong key={match.index}>{match[2]}</strong>);
    } else if (match[3]) {
      // Link
      parts.push(
        <a
          key={match.index}
          href={match[5]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {match[4]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [content];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  primaryColor,
}) => {
  const isUser = message.role === "user";

  return (
    <div className={`va-bubble-row ${message.role}`}>
      <div>
        <div
          className={`va-bubble ${message.role}`}
          style={isUser ? { backgroundColor: primaryColor } : undefined}
        >
          {formatContent(message.content)}
        </div>
        <div className="va-bubble-time">{formatTime(message.timestamp)}</div>
      </div>
    </div>
  );
};

export default MessageBubble;
