import React, { useState, useRef, useEffect } from "react";

interface InputBarProps {
  onSend: (message: string) => void;
  disabled: boolean;
  primaryColor: string;
}

const MAX_CHARS = 500;

const InputBar: React.FC<InputBarProps> = ({ onSend, disabled, primaryColor }) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const charCount = value.length;
  const canSend = value.trim().length > 0 && charCount <= MAX_CHARS && !disabled;

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 100) + "px";
    }
  }, [value]);

  const handleSend = () => {
    if (!canSend) return;
    onSend(value);
    setValue("");
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="va-input-bar">
      <div className="va-input-wrapper">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          aria-label="Message input"
        />
        {charCount > MAX_CHARS * 0.8 && (
          <span
            className={`va-char-counter ${
              charCount > MAX_CHARS ? "va-warn" : ""
            }`}
          >
            {charCount}/{MAX_CHARS}
          </span>
        )}
      </div>
      <button
        className="va-send-btn"
        onClick={handleSend}
        disabled={!canSend}
        style={{ backgroundColor: primaryColor }}
        aria-label="Send message"
      >
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </div>
  );
};

export default InputBar;
