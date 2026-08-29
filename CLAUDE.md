# Instructions for Claude Code working in this repo

## Hard preferences (non-negotiable, apply repo-wide)

- npm only — never yarn or pnpm
- No Express, no Next.js
- No `any` in TypeScript — if a type is genuinely unknown, use `unknown` and narrow it
- Zod validation at every route boundary — no unvalidated `c.req.json()`
- Every backend module follows the 4-file pattern: `schema.ts` (Zod +
  types), `service.ts` (business logic, D1/R2 access), `routes.ts` (Hono
  handlers), `index.ts` (barrel export). Don't collapse these into one file
  even for small modules.
- Shared `Bindings`/`Env` type lives in `src/lib/bindings.ts` — modules
  import from there, they don't declare their own.

## Data model rules

- R2 is the source of truth for memory content. D1 is an index/registry
  only — it should never hold data that isn't reconstructable from R2.
- `memory.jsonl` is append-only. Never rewrite history in place; the sync
  model (local CLI ↔ R2) depends on this being true. If you need to
  "edit" an entry, append a new one and treat resolution as an
  application-level concern, not a storage-level overwrite.
- Memory entries have a `type` of `entity`, `relation`, or `observation`.
  The frontend graph (`app/src/components/MemoryGraph.tsx`) assumes entity
  entries carry a `name` and relation entries carry `source`/`target`
  matching entity names — if you change entry shapes, update that
  assumption or the graph silently renders nothing.

## MCP + OAuth conventions (added with the /mcp layer)

- MCP tools are thin wrappers, no new logic. `src/modules/mcp` follows the
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
- Tool input schemas live in `mcp/schema.ts` as Zod *raw shapes* (what
  `registerTool` expects), and `append_memory` reuses `memoryEntrySchema`
  from the projects module rather than redefining the entry shape.
- OAuth wiring lives in `src/modules/auth`. `workers-oauth-utils.ts` is
  vendored from Cloudflare's `remote-mcp-github-oauth` reference (CSRF +
  session-bound state + signed approval cookies) — treat it as vendored
  code, keep changes minimal. `github-handler.ts` owns `/authorize` and
  `/callback`; the single-user allow-list (`ALLOWED_GITHUB_USER`) is
  enforced in `/callback`, the first point we know the real GitHub login.
- Only `/mcp` is gated. In `src/index.ts` the whole existing Hono app
  (REST + auth routes + asset fallback) is the OAuthProvider
  `defaultHandler`; `apiRoute` is `/mcp` alone. Never widen `apiRoute` to
  cover `/api/*` or the assets — those stay unauthenticated by design.

## What's deliberately not built yet

- Retrieval for chat — `ChatService` currently dumps the whole project's
  memory into the system prompt. Don't "fix" this by silently truncating;
  if it needs to change, it should become real retrieval (embeddings +
  top-k), flagged as a deliberate architecture change.
- Local sync CLI — not started. Should reuse the append-only id scheme
  (ulid per entry) so sync is a set union, never a merge conflict.

## Commands

```
npm run dev                  # Worker dev server
npm run db:generate          # after editing src/db/schema.ts
npm run db:migrate:local
npm run db:migrate:remote
npm run deploy
cd app && npm run dev        # frontend dev server (proxies /api to :8787)
cd app && npm run build      # required before npm run deploy
```
