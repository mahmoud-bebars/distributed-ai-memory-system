import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { ShareView } from "./components/ShareView";
import { ThemeProvider } from "./components/theme-provider";
import "./index.css";

// No router library — the app has exactly one URL-addressable route
// (/share/:token, for read-only share links) alongside the normal
// client-state-driven app at "/". A plain path check is enough.
const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)/);

// AuthGate wraps only the authenticated app — ShareView is public,
// token-in-URL authed, and has no session/cookie of its own to check.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="dams-ui-theme">
      {shareMatch ? (
        <ShareView token={shareMatch[1]} />
      ) : (
        <AuthGate>{(identity, onLogout) => <App identity={identity} onLogout={onLogout} />}</AuthGate>
      )}
    </ThemeProvider>
  </React.StrictMode>
);
