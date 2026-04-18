import React, { useState } from "react";
import FloatingButton from "./components/FloatingButton";
import ChatWindow from "./components/ChatWindow";

export interface WidgetProps {
  agentId: string;
  position?: "bottom-right" | "bottom-left";
  primaryColor?: string;
}

const Widget: React.FC<WidgetProps> = ({
  agentId,
  position = "bottom-right",
  primaryColor = "#4f46e5",
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
          position={position}
          primaryColor={primaryColor}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

export default Widget;
