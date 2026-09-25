import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Bindings } from "./lib/bindings";
import { githubAuthRoutes } from "./modules/auth";
import { chatRoutes } from "./modules/chat";
import { docsRoutes } from "./modules/docs";
import { mcpHandler } from "./modules/mcp";
import { projectsRoutes } from "./modules/projects";
import { projectShareRoutes, publicShareRoutes } from "./modules/shares";

// Everything that isn't the token-gated /mcp route: the REST API, the GitHub
// OAuth browser flow (/authorize, /callback), and the static frontend. This
// app is handed to the OAuthProvider as its `defaultHandler`, so it runs for
// unauthenticated requests too — which is exactly what we want, since /api/*
// and the UI are deliberately NOT behind OAuth.
const app = new Hono<{ Bindings: Bindings }>();

// Stopgap host guard for env.SHARE_HOSTNAME (see lib/bindings.ts) — the one
// hostname, if you've set one, meant to sit outside whatever access control
// protects your main domain, scoped by that access control (a dashboard
// setting, not this code — see CLAUDE.md's "Shareable read-only links"
// section) to just the paths listed below. That access control is the real
// gate; this middleware enforces the same allow-list in code as a
// belt-and-suspenders measure so a misconfigured or missing policy on that
// hostname can't expose the rest of the app. It is NOT a substitute for
// getting that policy right, and it's a no-op entirely if SHARE_HOSTNAME
// isn't set — /mcp is still gated by OAuthProvider below regardless.
const SHARE_HOSTNAME_EXACT_PATHS = new Set(["/mcp", "/authorize", "/token", "/register", "/callback"]);
const SHARE_HOSTNAME_PATH_PREFIXES = ["/.well-known/", "/share/", "/api/share/", "/assets/"];

function isAllowedOnShareHostname(pathname: string): boolean {
  return (
    SHARE_HOSTNAME_EXACT_PATHS.has(pathname) ||
    SHARE_HOSTNAME_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

app.use("*", async (c, next) => {
  const shareHostname = c.env.SHARE_HOSTNAME;
  if (!shareHostname) return next();
  // The `Host` header, not `new URL(c.req.url).hostname` — under wrangler
  // dev/Miniflare the request URL always reflects the local bind address
  // regardless of what a client sends as Host, so checking the header
  // directly is both what a real Workers Custom Domain routes on and the
  // only thing that's actually testable locally.
  const host = c.req.header("host");
  if (host === shareHostname && !isAllowedOnShareHostname(new URL(c.req.url).pathname)) {
    return c.notFound();
  }
  return next();
});

app.get("/api", (c) => c.json({ service: "distributed-ai-memory-system", status: "ok" }));
app.route("/api/projects", projectsRoutes);
app.route("/api/projects", chatRoutes);
app.route("/api/projects", projectShareRoutes);
app.route("/api/projects", docsRoutes);

// Public, token-authed read-only endpoint for share links. Reachable on your
// main domain too, but recipients are meant to hit it via
// env.SHARE_HOSTNAME/share/:token (if you've set one) — the one hostname
// whose access-control application is configured to bypass auth for
// /share/* and /api/share/* (a dashboard setting, not something this Worker
// enforces — see CLAUDE.md's share-link notes).
app.route("/api/share", publicShareRoutes);

// GitHub OAuth endpoints for the /mcp flow. Must be registered before the
// asset catch-all below, or the wildcard would swallow them.
app.route("/", githubAuthRoutes);

// Anything else falls through to the built frontend (see client/). Only runs for
// requests Workers Assets didn't already resolve to a static file.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// OAuth 2.1 gate, GitHub upstream, restricted to a single allow-listed user
// (enforced in the /callback handler). ONLY /mcp is protected — the REST API
// and UI ride the defaultHandler above with no auth. Matches Cloudflare's
// remote-mcp-github-oauth reference, minus the Durable Object: the 2026-07-28
// stateless MCP spec lets /mcp run as a plain per-request Worker handler.
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
});
