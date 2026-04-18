import React, { useState, useEffect } from "react";

interface FloatingButtonProps {
  isOpen: boolean;
  onClick: () => void;
  position: "bottom-right" | "bottom-left";
  primaryColor: string;
}

const FloatingButton: React.FC<FloatingButtonProps> = ({
  isOpen,
  onClick,
  position,
  primaryColor,
}) => {
  const [showPulse, setShowPulse] = useState(true);

  useEffect(() => {
    // Remove pulse after animation completes (~7s for 3 iterations)
    const timer = setTimeout(() => setShowPulse(false), 7500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      className={`va-floating-btn ${position} ${isOpen ? "va-open" : ""} ${
        showPulse && !isOpen ? "va-pulse" : ""
      }`}
      style={{ backgroundColor: primaryColor }}
      onClick={onClick}
      aria-label={isOpen ? "Close chat" : "Open chat"}
    >
      {isOpen ? (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
          <path d="M7 9h10v2H7zM7 6h10v2H7z" />
        </svg>
      )}
    </button>
  );
};

export default FloatingButton;
