import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ShareView } from "./components/ShareView";
import "./index.css";

// No router library — the app has exactly one URL-addressable route
// (/share/:token, for read-only share links) alongside the normal
// client-state-driven app at "/". A plain path check is enough.
const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)/);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {shareMatch ? <ShareView token={shareMatch[1]} /> : <App />}
  </React.StrictMode>
);
