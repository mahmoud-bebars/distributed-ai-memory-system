# Instructions for Claude Code working in this repo

## Repo layout

npm workspaces monorepo, two workspaces under one root `package.json`:
`server/` (the Cloudflare Worker — Hono, D1, R2, MCP/OAuth) and `client/`
(the Vite/React frontend, built into `client/dist` and served by the Worker
as static assets). Run `npm install` once from the repo root. Root-level
`npm run <script>` commands delegate to the right workspace — see
"Commands" below. `wrangler.toml` and its CLI (`wrangler d1 ...`,
`wrangler secret put ...`) live in and must run from `server/`.

## Hard preferences (non-negotiable, apply repo-wide)

- npm only — never yarn or pnpm
- No Express, no Next.js
- No `any` in TypeScript — if a type is genuinely unknown, use `unknown` and narrow it
- Zod validation at every route boundary — no unvalidated `c.req.json()`
- Every backend module follows the 4-file pattern: `schema.ts` (Zod +
  types), `service.ts` (business logic, D1/R2 access), `routes.ts` (Hono
  handlers), `index.ts` (barrel export). Don't collapse these into one file
  even for small modules.
- Shared `Bindings`/`Env` type lives in `server/src/lib/bindings.ts` — modules
  import from there, they don't declare their own.

## Data model rules

- R2 is the source of truth for memory content. D1 is an index/registry
  only — it should never hold data that isn't reconstructable from R2.
- `memory.jsonl` is append-only. Never rewrite history in place; the sync
  model (local CLI ↔ R2) depends on this being true. If you need to
  "edit" an entry, append a new one and treat resolution as an
  application-level concern, not a storage-level overwrite.
- Memory entries have a `type` of `entity`, `relation`, or `observation`.
  The frontend graph (`client/src/components/MemoryGraph.tsx`) assumes entity
  entries carry a `name` and relation entries carry `source`/`target`
  matching entity names — if you change entry shapes, update that
  assumption or the graph silently renders nothing.
- Content shape conventions by type (documented, not Zod-enforced — see
  `memoryEntrySchema` in `server/src/modules/projects/schema.ts` — enforcing them
  strictly would reject entries written before the convention existed):
  - `entity`: `{ name, category? }`. `category` is one of
    `entityCategorySchema`'s ten values; readers default to `"other"`
    (`DEFAULT_ENTITY_CATEGORY`) when it's absent. Old entities predate this
    field — that's expected, not a bug to backfill automatically.
  - `observation`: `{ text, entity? }`. `text` is the plain-language note;
    `entity` optionally names which entity (by name) it's about — absent
    means a general project note, not an error. Entries that predate this
    shape (no `text` string) fall back to a JSON preview in the UI rather
    than breaking.
  - `relation`: `{ source, target, label? }` — unchanged.
- **Entities are last-write-wins, not append-once.** An entity can be
  appended again under the same `name`; the append-only log keeps every
  revision (the raw R2 file and `read_memory` still return all of them —
  never filtered), but any reader building a "current" view (the frontend
  graph/entries table, `update_entity`) should dedupe by `content.name`
  and keep the last occurrence in file order. The canonical implementation
  is `currentEntities()`, duplicated in `server/src/modules/projects/service.ts`
  (backend) and `client/src/lib/memory.ts` (frontend, which doesn't build
  against the Worker's source tree) — keep both in sync if the rule
  changes. Relations and observations are never deduped; every one is
  part of the log.
- `update_entity` (MCP tool, `server/src/modules/mcp`) is how a category (or any
  other entity field) gets attached after the fact: it appends a new
  entity revision merging the given fields onto the entity's current
  content. It fails clearly if no entity with that name exists yet —
  creating one is still `append_memory`'s job.

## MCP + OAuth conventions (added with the /mcp layer)

- MCP tools are thin wrappers, no new logic. `server/src/modules/mcp` follows the
  4-file pattern with one adaptation: `service.ts` exports a
  `buildMemoryMcpServer(env)` factory that registers tools by delegating
  straight to `ProjectsService`/`ChatService`, and `routes.ts` exports a
  plain `ExportedHandler` (`mcpHandler`) instead of a Hono router — the
  OAuthProvider wants a bare fetch handler for its `apiHandler`.
- `/mcp` is stateless. Under the MCP 2026-07-28 spec the session handshake
  (`Mcp-Session-Id`) is gone, so each request builds a throwaway
  `McpServer` + `WebStandardStreamableHTTPServerTransport`
  (`sessionIdGenerator: undefined`). No Durable Object / `McpAgent` — a
  single-user server doesn't need one. Don't reintroduce DO state unless a
  feature genuinely requires cross-request session memory.
- Always pass `CfWorkerJsonSchemaValidator` to `new McpServer`. The SDK's
  Ajv default compiles schemas with `new Function`, which the Workers
  runtime forbids.
- Tool input schemas live in `server/src/modules/mcp/schema.ts` as Zod *raw shapes* (what
  `registerTool` expects), and `append_memory` reuses `memoryEntrySchema`
  from the projects module rather than redefining the entry shape.
  `update_entity` similarly reuses `entityCategorySchema`.
- OAuth wiring lives in `server/src/modules/auth`. `workers-oauth-utils.ts` is
  vendored from Cloudflare's `remote-mcp-github-oauth` reference (CSRF +
  session-bound state + signed approval cookies) — treat it as vendored
  code, keep changes minimal. `github-handler.ts` owns `/authorize` and
  `/callback`; the single-user allow-list (`ALLOWED_GITHUB_USER`) is
  enforced in `/callback`, the first point we know the real GitHub login.
- Only `/mcp` is gated. In `server/src/index.ts` the whole existing Hono app
  (REST + auth routes + asset fallback) is the OAuthProvider
  `defaultHandler`; `apiRoute` is `/mcp` alone. Never widen `apiRoute` to
  cover `/api/*` or the assets — those stay unauthenticated by design.

## Shareable read-only links

- `server/src/modules/shares` (4-file pattern) owns a project's share links — a
  project can have any number of them (`project_shares`, `token` as PK,
  not `slug`; migration `0003_share_links.sql`). Each link is independently
  configured: a `label`, `allowChat`/`allowDocs` booleans, and an
  `expiresAt` (nullable — null means never). `SharesService.create`/
  `.update`/`.revoke`/`.list` are straightforward CRUD; `.resolveByToken`
  is the public lookup path and is where expiry is enforced (an expired
  link resolves to `null`, same as a token that never existed).
- Graph + Entries (i.e. project memory) has no per-link gate — sharing at
  all means sharing at least that. Docs and Chat are opt-in per link via
  `allowDocs`/`allowChat`, enforced server-side on the public routes
  themselves (`/api/share/:token/docs*`, `/api/share/:token/chat`), not
  just hidden in the frontend. `.../chat` reuses `ChatService.ask` with
  `allowMutatingTools: false` (no update_doc/delete_doc tools offered —
  there's no approve/reject UI on a read-only share to act on one anyway)
  and `includeDocs: share.allowDocs` (a docs-off link keeps doc content
  out of chat answers too, not just out of the Docs tab).
- Two route groups, both mounted in `server/src/index.ts`: `projectShareRoutes`
  (`GET`/`POST /api/projects/:slug/share`, `PATCH`/`DELETE
  /api/projects/:slug/share/:token`, authenticated the same loose way the
  rest of `/api/*` is) and `publicShareRoutes` (`GET /api/share/:token` for
  link metadata, `GET /api/share/:token/memory`, docs, and
  `POST /api/share/:token/chat`, deliberately unauthenticated — the token
  *is* the auth). An unknown, expired, or permission-gated-off token always
  404s with the same generic body; never branch differently between those
  cases, so a guess can't learn anything from the response.
- `shareUrl()` in `server/src/modules/shares/service.ts` hardcodes the share
  host as `mcp.mahmoudbebars.dev` — that's the one custom domain (see
  `server/wrangler.toml`'s `routes`) deliberately left outside Cloudflare Access,
  because a share recipient has no Access login to give. **The Access
  application for that hostname is configured in the Cloudflare
  dashboard, not in this repo** — it bypasses auth only for
  `/mcp`, `/.well-known/*`, `/authorize`, `/token`, `/register`,
  `/callback`, and now needs `/share/*` and `/api/share/*` added to that
  same bypass list by hand. No amount of Worker code changes this; the
  Access check happens at Cloudflare's edge before a request ever reaches
  this Worker.
- **In-code host guard, `server/src/index.ts` (added 2026-09-08).** When this was
  built, `mcp.mahmoudbebars.dev` turned out to have no working Access
  restriction at all — the full REST API, reads and writes, was reachable
  there unauthenticated. A `Hono` middleware (first thing registered on
  `app`) now enforces the same allow-list in code: on that exact `Host`
  header, only `/mcp`, `/authorize`, `/token`, `/register`, `/callback`,
  `/.well-known/*`, `/share/*`, `/api/share/*`, and `/assets/*` pass
  through; everything else 404s. This is a stopgap, not a fix for the
  underlying Access misconfiguration — verify Access itself before ever
  removing this guard, don't just assume it's been fixed because this
  code exists. Static assets (`/`, favicons, `index.html` itself) can
  still be fetched on that hostname even from a browser that never sends
  a spoofable header, because Cloudflare serves matched static files
  straight from its edge cache **before** invoking the Worker at all —
  this guard never sees those requests. That's an accepted gap: those
  files carry no data (the compiled SPA shell is public by nature
  either way), so it's cosmetic, not a leak. Closing it would mean
  `run_worker_first` in `[assets]`, which would route every static asset
  on `memory.mahmoudbebars.dev` through the Worker too — deliberately not
  done here, don't add it without discussing the perf trade-off first.
  Test this guard against the real deployed hostnames, not `wrangler
  dev`: Miniflare doesn't forward a client-supplied `Host` header into
  the Worker's request, so local `curl -H "Host: ..."` spoofing can't
  actually exercise this logic.
- `server/wrangler.toml`'s `[assets]` sets
  `not_found_handling = "single-page-application"` specifically so a cold
  page load of `/share/:token` (a client-side-only route, no matching
  static file) falls back to `index.html` instead of 404ing.
- Frontend: `client/src/main.tsx` does a plain path check
  (`/^\/share\/([^/]+)/`) — no router library — and renders `ShareView`
  instead of `App` when it matches. `ShareView` first calls
  `api.getShareMeta(token)` to learn which tabs it's allowed to offer
  *before* rendering the tab list at all, so a docs-off/chat-off link never
  even shows those triggers rather than showing-then-hiding them. It
  reuses `MemoryGraph`/`EntriesTable`/`DocsPanel` (all already read-only)
  and, for a chat-enabled link, `ChatPanel` — the same component the
  authenticated view uses, made source-agnostic via its `ask` prop
  (`ProjectView` passes `api.askChat`, `ShareView` passes
  `api.askShareChat`) rather than hardcoding which endpoint to call.
  Always no create-project form, no Export, no mutating doc controls
  regardless of link settings. The authenticated app manages links (plural
  now) through `ShareDialog`, opened from `ProjectView`'s consolidated
  actions dropdown — create/edit/revoke any number of them per project.

## Frontend conventions (shadcn/ui)

- `client/` uses shadcn/ui (CLI-managed, `radix-nova` preset) on top of
  **Tailwind v4**, not v3 — v4 was the CLI's current default when this was
  set up, and its generated components rely on v4-only CSS (`@theme`,
  `@custom-variant`). Don't reintroduce a v3 `tailwind.config.js`; theming
  lives in `client/src/index.css` via `@theme inline` + CSS custom properties.
  Styling is driven by `@tailwindcss/vite`, not postcss — there's no
  `postcss.config.js`.
- Primitives live in `client/src/components/ui/` and are installed with
  `npx shadcn@latest add <component>` from inside `client/` — never
  hand-write a component that mimics shadcn's API; add it with the CLI so
  it stays in sync with `components.json`.
- Path alias `@/*` → `client/src/*` (see `client/tsconfig.json` and
  `client/vite.config.ts`) — shadcn components import via `@/lib/utils` etc.,
  so new files should follow that convention too.
- Layout is sidebar + tabs, not the old list/detail toggle: `AppSidebar`
  (project switcher) wraps `SidebarProvider`/`SidebarInset`, and
  `ProjectView` renders `Tabs` (Graph / Entries / Chat / Prompts) plus the
  Share and Export controls, per project.
- Guide and prompt-template content lives in the app itself, not this
  repo's docs: `client/src/components/GuidePage.tsx` (linked from the
  sidebar, next to "New project") documents the MCP connect command, the
  `/mcp` auth flow, and the actual tool list — kept in sync **by hand**
  with `server/src/modules/mcp/service.ts`'s `registerTool` calls, since there's
  no build-time link between them. `client/src/lib/prompts.ts` holds the
  seed/sync prompt templates (`{PROJECT_SLUG}` substituted per project),
  rendered in `ProjectView`'s Prompts tab via `PromptsPanel`.

## What's deliberately not built yet

- Retrieval for chat — `ChatService` currently dumps the whole project's
  memory into the system prompt. Don't "fix" this by silently truncating;
  if it needs to change, it should become real retrieval (embeddings +
  top-k), flagged as a deliberate architecture change.
- Local sync CLI — not started. Should reuse the append-only id scheme
  (ulid per entry) so sync is a set union, never a merge conflict.

## Commands

This is an npm workspaces monorepo: `server/` (the Worker) and `client/`
(the frontend) are both workspaces under the root `package.json`. Run
`npm install` once from the repo root — it installs both. The commands
below run from the repo root and delegate to the right workspace; they're
thin wrappers over the corresponding script in `server/package.json` or
`client/package.json`.

```
npm run dev                  # Worker dev server (server workspace)
npm run dev:client           # frontend dev server (proxies /api to :8787)
npm run db:generate          # after editing server/src/db/schema.ts — see note below
npm run db:migrate:local
npm run db:migrate:remote
npm run build                # builds the client workspace into client/dist
npm run deploy                # builds client, then wrangler deploy in server/
```

`db:generate` (`drizzle-kit generate`) only works cleanly if
`server/migrations/meta/` exists and tracks prior migrations. It doesn't
here — `0001_init.sql` was hand-written, so running `generate` produces a
fresh "baseline" migration that recreates every table from scratch instead
of a real diff. When that happens, discard the generated file (and any
`server/migrations/meta/` it created) and hand-write the incremental
migration in the same `CREATE TABLE IF NOT EXISTS` style as the existing
ones, numbered to follow on (`server/migrations/0002_project_shares.sql` is
the example to copy).
