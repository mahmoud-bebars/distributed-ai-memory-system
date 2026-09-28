import { Hono } from "hono";
import type { Bindings } from "./lib/bindings";
import { chatRoutes } from "./modules/chat";
import { docsRoutes } from "./modules/docs";
import { handleMcpRequest } from "./modules/mcp";
import { projectsRoutes } from "./modules/projects";
import { projectShareRoutes, publicShareRoutes } from "./modules/shares";
import { authRoutes, requireApiAuth, tokenManagementRoutes, type TokenAuth } from "./modules/tokens";

type AppEnv = { Bindings: Bindings; Variables: { tokenAuth: TokenAuth } };

// The whole app: the REST API, /mcp, the auth/token routes, and the static
// frontend. Every route is gated in code now — see requireApiAuth below —
// there is no OAuthProvider wrapper and no route left implicitly relying on
// Cloudflare Access alone (Access can still sit in front of this in
// production as an extra edge-level layer, but the Worker no longer
// depends on it for correctness).
const app = new Hono<AppEnv>();

// Stopgap host guard for env.SHARE_HOSTNAME (see lib/bindings.ts) — the one
// hostname, if you've set one, meant to sit outside whatever access control
// protects your main domain, scoped by that access control (a dashboard
// setting, not this code — see CLAUDE.md's "Shareable read-only links"
// section) to just the paths listed below. That access control is the real
// gate; this middleware enforces the same allow-list in code as a
// belt-and-suspenders measure so a misconfigured or missing policy on that
// hostname can't expose the rest of the app. It is NOT a substitute for
// getting that policy right, and it's a no-op entirely if SHARE_HOSTNAME
// isn't set — /mcp and /api/* are still gated by requireApiAuth below
// regardless.
const SHARE_HOSTNAME_EXACT_PATHS = new Set(["/mcp"]);
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

// Auth: /login and /logout are the only unauthenticated routes on the whole
// app (besides the public share routes below) — everything else requires a
// credential to have come from one of them (or a bearer header) first.
app.route("/api/auth", authRoutes);

app.use("/api/tokens/*", requireApiAuth({ minScope: "admin" }));
app.route("/api/tokens", tokenManagementRoutes);

// GET needs read_only, everything else needs read_write — see
// requireApiAuth's default in modules/tokens/middleware.ts.
app.use("/api/projects/*", requireApiAuth());
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

// /mcp: always read_only minimum (every MCP request is a POST, so it can't
// be split by method the way the REST routes above are) — the actual
// read_write/admin distinction happens inside buildMemoryMcpServer, which
// only registers the mutating tools for a scope that has them.
app.all("/mcp", requireApiAuth({ minScope: "read_only" }), (c) =>
  handleMcpRequest(c.req.raw, c.env, c.get("tokenAuth").scope),
);

// Anything else falls through to the built frontend (see client/). Only runs for
// requests Workers Assets didn't already resolve to a static file.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
