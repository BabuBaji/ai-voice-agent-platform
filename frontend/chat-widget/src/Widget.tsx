import React, { useState } from "react";
import FloatingButton from "./components/FloatingButton";
import ChatWindow from "./components/ChatWindow";

export interface WidgetProps {
  agentId: string;
  position?: "bottom-right" | "bottom-left";
  primaryColor?: string;
  /** Public chat endpoint base URL — points to ai-runtime. */
  apiUrl?: string;
  /** Stable per-visitor id (e.g. from analytics) so conversations thread across page loads. */
  visitorId?: string;
}

const Widget: React.FC<WidgetProps> = ({
  agentId,
  position = "bottom-right",
  primaryColor = "#4f46e5",
  apiUrl,
  visitorId,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <FloatingButton
        isOpen={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        position={position}
        primaryColor={primaryColor}
      />
      {isOpen && (
        <ChatWindow
          agentId={agentId}
          apiUrl={apiUrl}
          visitorId={visitorId}
          position={position}
          primaryColor={primaryColor}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

export default Widget;
