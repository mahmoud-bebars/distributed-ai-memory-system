import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Bindings } from "./lib/bindings";
import { githubAuthRoutes } from "./modules/auth";
import { chatRoutes } from "./modules/chat";
import { mcpHandler } from "./modules/mcp";
import { projectsRoutes } from "./modules/projects";

// Everything that isn't the token-gated /mcp route: the REST API, the GitHub
// OAuth browser flow (/authorize, /callback), and the static frontend. This
// app is handed to the OAuthProvider as its `defaultHandler`, so it runs for
// unauthenticated requests too — which is exactly what we want, since /api/*
// and the UI are deliberately NOT behind OAuth.
const app = new Hono<{ Bindings: Bindings }>();

app.get("/api", (c) => c.json({ service: "distributed-ai-memory-system", status: "ok" }));
app.route("/api/projects", projectsRoutes);
app.route("/api/projects", chatRoutes);

// GitHub OAuth endpoints for the /mcp flow. Must be registered before the
// asset catch-all below, or the wildcard would swallow them.
app.route("/", githubAuthRoutes);

// Anything else falls through to the built frontend (see app/). Only runs for
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
