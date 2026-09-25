# Task: add the MCP server + OAuth layer

## Before writing any code

Read, in order: CLAUDE.md, PROJECT_UNDERSTANDING.md, README.md, and the
existing `src/modules/projects/` and `src/modules/chat/` modules. This
task must follow the conventions those files already establish, not
introduce new ones.

Then verify current APIs before implementing anything — do not rely on
training data for these, they move fast:
- The MCP TypeScript SDK's current recommended way to mount a remote
  MCP server on Cloudflare Workers under the 2026-07-28 stateless spec
  revision (session handshake and Mcp-Session-Id were removed — confirm
  whether Durable Objects are still needed for this use case or whether a
  stateless per-request handler is sufficient; prefer the simpler option
  if the spec genuinely allows it for a single-user server).
- `@cloudflare/workers-oauth-provider`'s current API, using Cloudflare's
  own `remote-mcp-github-oauth` reference template as the pattern to
  follow.

If anything below conflicts with what you find in current docs, current
docs win — this brief describes the goal and constraints, not a
prescribed implementation.

## Goal

One deployment, three things gated differently:

1. `/api/*` (existing REST) and the frontend — stay exactly as they are,
   no auth changes.
2. A new `/mcp` route exposing the project's memory as MCP tools.
3. `/mcp` (only) protected by OAuth 2.1, using GitHub as the upstream
   identity provider, restricted to a single allow-listed GitHub username.

## Part A — MCP tools

Add a new module following the existing 4-file pattern
(`src/modules/mcp/{schema,service,routes,index}.ts`, or whatever shape
the MCP SDK actually requires — adapt the pattern, don't force it if the
SDK's own conventions genuinely conflict).

Tools should be thin wrappers over the existing services — no new
business logic:

- `list_projects` → `ProjectsService.list()`
- `read_memory(slug)` → `ProjectsService.readMemory(slug)`
- `append_memory(slug, entry)` → `ProjectsService.appendMemory(slug, entry)`
  — validate `entry` with the existing `memoryEntrySchema` from
  `modules/projects/schema.ts`, don't redefine it
- `ask_memory(slug, question)` → `ChatService.ask(slug, question)`

Do not add a `create_project` tool yet — creating projects stays a
deliberate REST-API action for now, not something an AI client does
unprompted.

## Part B — OAuth on `/mcp` only

Use `@cloudflare/workers-oauth-provider` with GitHub as the upstream
provider, matching Cloudflare's `remote-mcp-github-oauth` reference:

- `apiRoute` should be `/mcp` (or whatever prefix Part A actually used) —
  it must not wrap `/api/*` or the asset fallback.
- During the `/authorize` step, check the authenticated GitHub username
  against a single allow-listed value. Read that value from a new
  binding — call it `ALLOWED_GITHUB_USER` — don't hardcode a username in
  source.
- Required secrets/bindings: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
  `COOKIE_ENCRYPTION_KEY`, an `OAUTH_KV` namespace, and
  `ALLOWED_GITHUB_USER`.

**Stop and ask me** if any of `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
or `ALLOWED_GITHUB_USER` aren't already set as secrets/vars — don't guess
values or ask me to paste a secret into chat. Tell me the exact
`wrangler secret put ...` / `wrangler kv namespace create ...` commands
to run myself, and wait.

## Part C — frontend auth (do not implement)

The web UI should eventually sit behind Cloudflare Access. That's a
Cloudflare dashboard / zone-level setting, not application code — don't
attempt to configure it via API calls or add code for it. Just confirm
in your final summary that this is still a manual step I need to do in
the Cloudflare dashboard, and leave it noted in PROJECT_UNDERSTANDING.md.

## Constraints (from CLAUDE.md — don't relitigate these)

- npm only, no Express, no Next.js, no `any`, Zod at every boundary
- R2 stays the source of truth; memory.jsonl stays append-only — nothing
  in this task should rewrite existing lines
- Don't touch `ChatService`'s context strategy (still naive full-dump) —
  out of scope here

## When done

- `npm run typecheck` and `npm run build` (both root and `app/`) must
  pass clean.
- Update wrangler.toml with any new bindings.
- Update CLAUDE.md's "What's deliberately not built yet" section — move
  MCP/OAuth out of it, and add whatever new conventions this introduced
  (e.g. how MCP tools are structured, if it diverged from the 4-file
  pattern).
- Update PROJECT_UNDERSTANDING.md's "Current status" section to match
  reality, including the Cloudflare Access step that's still manual.
- `git commit` your changes with a clear message. Do **not** `git push` —
  I want to review the diff first, especially the OAuth wiring.
- Give me a short summary: what changed, what I still need to do outside
  the code (secrets, Cloudflare Access, anything else), and how to test
  `/mcp` locally with the MCP inspector before I point a real client at
  the deployed one.
