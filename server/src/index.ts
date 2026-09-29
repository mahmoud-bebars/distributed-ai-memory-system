import { Hono } from "hono";
import type { Bindings } from "./lib/bindings";
import { ActionsService, actionsRoutes } from "./modules/actions";
import { assistantRoutes, TasksService } from "./modules/assistant";
import { chatRoutes } from "./modules/chat";
import { docsRoutes } from "./modules/docs";
import { handleMcpRequest } from "./modules/mcp";
import { projectsRoutes } from "./modules/projects";
import { SearchService, searchRoutes } from "./modules/search";
import { projectShareRoutes, publicShareRoutes } from "./modules/shares";
import { authRoutes, canAccessProject, requireApiAuth, tokenManagementRoutes, type TokenAuth } from "./modules/tokens";

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

// Per-project allow-list enforcement, in one place, for every route shaped
// /api/projects/:slug(/...). Hono matches this pattern against the bare
// "/api/projects/:slug" as well as any deeper path — verified against
// PATCH .../:slug and GET .../:slug/memory alike — so this single
// middleware covers projects, chat, docs, and share routes without each
// module hand-checking. It deliberately does NOT match bare "/api/projects"
// (list/create), which have no slug to check — those are gated individually
// in projectsRoutes (list is filtered, create is scope-checked) since the
// rule there isn't "reject", it's "filter" or "forbid". A disallowed slug
// 404s, never 403s, so a restricted token can't learn the project exists.
app.use("/api/projects/:slug/*", async (c, next) => {
  const auth = c.get("tokenAuth");
  if (!canAccessProject(auth, c.req.param("slug"))) return c.notFound();
  return next();
});

// Cross-project hybrid search. GET needs read_only, and results are always
// filtered to what this token can see; starting a reindex needs admin.
app.use("/api/search/*", requireApiAuth());
app.use("/api/search/reindex", requireApiAuth({ minScope: "admin" }));
app.route("/api/search", searchRoutes);

// Action plans (propose → approve → execute). Propose needs read_write (the
// method-based default); approve/reject need admin — an MCP client's
// read_write token can propose but never approve. See modules/actions.
app.use("/api/plans/*", requireApiAuth());
app.use("/api/plans/:id/approve", requireApiAuth({ minScope: "admin" }));
app.use("/api/plans/:id/reject", requireApiAuth({ minScope: "admin" }));
app.use("/api/plans/:id/resume", requireApiAuth({ minScope: "admin" }));
app.route("/api/plans", actionsRoutes);

// The global assistant: chat (SSE), conversations, tasks. Chatting needs
// read_write; cancelling/resuming a task rejects or executes a plan, so those
// need admin — same reasoning as approve/reject above.
app.use("/api/assistant/*", requireApiAuth());
app.use("/api/assistant/tasks/:id/cancel", requireApiAuth({ minScope: "admin" }));
app.use("/api/assistant/tasks/:id/resume", requireApiAuth({ minScope: "admin" }));
app.route("/api/assistant", assistantRoutes);

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
  handleMcpRequest(c.req.raw, c.env, c.get("tokenAuth"), c.executionCtx),
);

// Anything else falls through to the built frontend (see client/). Only runs for
// requests Workers Assets didn't already resolve to a static file.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// The Workflow class must be exported from the Worker's entry module for the
// [[workflows]] binding in wrangler.toml to find it.
export { SearchBackfillWorkflow } from "./modules/search";
export { ActionsWorkflow } from "./modules/actions";

export default {
  fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  // Cron sweep (see [triggers] in wrangler.toml.example): retries entries
  // whose indexing was paused or failed. Never throws into the runtime.
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(new SearchService(env).sweep().catch((err) => console.error("search sweep failed", err)));
    // Approval timeout + keep task state in step with its plan.
    ctx.waitUntil(
      new ActionsService(env)
        .expirePending()
        .then(() => new TasksService(env).refreshFromPlans())
        .catch((err) => console.error("plan expiry/task refresh failed", err)),
    );
  },
} satisfies ExportedHandler<Bindings>;
