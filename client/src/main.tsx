import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes, useParams } from "react-router";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { ShareView } from "./components/ShareView";
import { ThemeProvider } from "./components/theme-provider";
import "./index.css";

function ShareRoute() {
  const { token } = useParams();
  return <ShareView token={token ?? ""} />;
}

// Every URL is a real route now. The Worker serves index.html for any
// unmatched navigation (`not_found_handling = "single-page-application"` in
// wrangler.toml), so a refresh or pasted deep link lands here. Keep app route
// paths off the server's own prefixes: /api, /mcp, /.well-known.
//
// AuthGate wraps only the authenticated app — /share/:token is public,
// token-in-URL authed, and has no session/cookie of its own to check.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="dams-ui-theme">
      <BrowserRouter>
        <Routes>
          <Route path="/share/:token/*" element={<ShareRoute />} />
          <Route
            path="/*"
            element={
              <AuthGate>{(identity, onLogout) => <App identity={identity} onLogout={onLogout} />}</AuthGate>
            }
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
