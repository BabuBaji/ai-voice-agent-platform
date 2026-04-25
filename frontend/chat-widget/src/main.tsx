import React from "react";
import ReactDOM from "react-dom/client";
import Widget, { WidgetProps } from "./Widget";
import cssText from "./styles/widget.css?inline";

/**
 * Voice Agent Chat Widget
 *
 * Embed via script tag:
 *   <script src="widget.js" data-agent-id="your-agent-id"></script>
 *
 * Or programmatic init:
 *   window.VoiceAgentWidget.init({ agentId: "your-agent-id" });
 */

interface WidgetConfig {
  agentId: string;
  position?: "bottom-right" | "bottom-left";
  primaryColor?: string;
  containerId?: string;
  /** Public chat endpoint base URL — defaults to current origin or http://localhost:8000. */
  apiUrl?: string;
  /** Stable per-visitor id (e.g. from your analytics) for cross-page-load conversation threading. */
  visitorId?: string;
}

let root: ReactDOM.Root | null = null;

function init(config: WidgetConfig) {
  if (root) {
    console.warn("[VoiceAgentWidget] Widget already initialized.");
    return;
  }

  // Create host element
  const hostId = config.containerId || "va-chat-widget-host";
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    document.body.appendChild(host);
  }

  // Attach shadow DOM for style isolation
  const shadow = host.attachShadow({ mode: "open" });

  // Inject styles into shadow DOM
  const styleEl = document.createElement("style");
  styleEl.textContent = cssText;
  shadow.appendChild(styleEl);

  // Set CSS custom property for primary color
  if (config.primaryColor) {
    const rgb = hexToRgb(config.primaryColor);
    if (rgb) {
      styleEl.textContent += `\n:host { --va-primary: ${config.primaryColor}; --va-primary-rgb: ${rgb}; }`;
    }
  }

  // Create mount point inside shadow DOM
  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  // Render
  root = ReactDOM.createRoot(mountPoint);
  root.render(
    <React.StrictMode>
      <Widget
        agentId={config.agentId}
        position={config.position}
        primaryColor={config.primaryColor}
        apiUrl={config.apiUrl}
        visitorId={config.visitorId}
      />
    </React.StrictMode>
  );
}

function destroy() {
  if (root) {
    root.unmount();
    root = null;
  }
  const host = document.getElementById("va-chat-widget-host");
  if (host) host.remove();
}

function hexToRgb(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : null;
}

// Expose public API
const api = { init, destroy };
(window as any).VoiceAgentWidget = api;

// Auto-init from script tag attributes
(function autoInit() {
  // Find the script tag that loaded this widget
  const scripts = document.querySelectorAll("script[data-agent-id]");
  const currentScript = scripts[scripts.length - 1];

  if (currentScript) {
    const agentId = currentScript.getAttribute("data-agent-id");
    if (agentId) {
      const position =
        (currentScript.getAttribute("data-position") as WidgetProps["position"]) ||
        "bottom-right";
      const primaryColor =
        currentScript.getAttribute("data-primary-color") || "#4f46e5";
      const apiUrl = currentScript.getAttribute("data-api-url") || undefined;
      const visitorId = currentScript.getAttribute("data-visitor-id") || undefined;

      const config: WidgetConfig = { agentId, position, primaryColor, apiUrl, visitorId };

      // Wait for DOM ready
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => init(config));
      } else {
        init(config);
      }
    }
  }
})();

export default api;
