# Project understanding

## The goal

A memory layer that isn't locked to one machine or one AI provider. Any
MCP-capable client (Claude, ChatGPT, Gemini CLI, Claude Code) should be
able to read and write the same project memory, from any machine. A
longer-term goal — not started — is mining that memory for patterns in
how the owner works, but that's a separate concern layered on top of
clean storage, not something to design for yet.

## Why this shape

**One Worker, not separate services.** Hono on Cloudflare Workers serving
REST API, (future) MCP protocol, and the built frontend as static assets,
all from one deployment on memory.mahmoudbebars.dev. Matches how Hoqooqi
is run. Avoids managing multiple deployment targets for a single-user tool.

**R2 is the source of truth, not the local machine.** Original plan had
the local machine as canonical with R2 as backup; inverted deliberately —
if local were canonical, "take memory anywhere" would still bottleneck on
one machine being reachable. Local becomes a synced working copy instead.

**D1 is an index, not a data store.** `projects` table holds slug, title,
summary, tags, r2_key, entity_count, timestamps — enough to list/search
projects fast. The actual memory content lives only in R2's
`{slug}/memory.jsonl`. If D1 were wiped, it should be fully reconstructable
by re-scanning R2 bucket keys.

**JSONL, append-only.** Chosen because it makes sync conflict-free by
construction: two devices appending lines can always be merged as a set
union sorted by id, no real merge logic needed. This only holds if nothing
ever rewrites existing lines — `ChatService` and `ProjectsService` both
currently respect this; any future code touching R2 memory blobs must too.

**Drizzle over raw D1 queries.** Swapped in after the initial raw-SQL
scaffold. Reason: Prisma/Sequelize (the usual preference) don't run
natively on the Workers runtime; Drizzle is the ORM that actually works at
the edge and still gives real types from the schema.

**Chat-with-memory is naive on purpose, for now.** `ChatService` dumps the
full `memory.jsonl` into the system prompt and asks Claude
(`claude-sonnet-5` via the Messages API) to answer from it. No retrieval,
no embeddings. This is a known, accepted limitation, not an oversight — it
degrades (context gets large) rather than fails, and buying real retrieval
before there's enough real memory data to need it would be premature.

**MCP comes after the REST layer, not instead of it.** The `/api/projects`
REST endpoints are the actual implementation. MCP tools (`list_projects`,
`search_memory`, `append_memory`) should be added as a thin protocol
wrapper calling the same `ProjectsService`/`ChatService` methods — this
was the deliberate build order (validate storage and logic in isolation
via curl before adding a second, harder-to-debug protocol layer on top).

## Auth plan

Two different things need gating, and they're not the same mechanism:

- **The web UI** — single user, low stakes. Cloudflare Access (Zero
  Trust) with an email allow-list is enough; not yet configured.
- **The MCP endpoint** — Claude, ChatGPT, and Gemini all expect a real
  OAuth 2.1 resource-server handshake, not a cookie. Plan is
  `@cloudflare/workers-oauth-provider`, using GitHub as the upstream
  identity provider (single-user allow-list check on GitHub username
  during the `/authorize` step), following Cloudflare's
  `remote-mcp-github-oauth` reference pattern. This only needs to gate the
  future `/mcp` route — it should not wrap the REST API or the UI.

## Current status

REST API (projects CRUD, memory read/append) and chat-with-memory are
built and deployed.

The **MCP layer and OAuth are now built** (`src/modules/mcp` and
`src/modules/auth`). `/mcp` exposes four tools — `list_projects`,
`read_memory`, `append_memory`, `ask_memory` — as thin wrappers over the
existing services (no `create_project`; project creation stays REST-only).
It runs stateless per the MCP 2026-07-28 spec: no Durable Object, just a
throwaway server + Web Standard Streamable HTTP transport per request.
Only `/mcp` is gated, by `@cloudflare/workers-oauth-provider` with GitHub
as the upstream IdP, restricted to a single `ALLOWED_GITHUB_USER` checked
during the OAuth callback. `/api/*` and the web UI are untouched.

Still outstanding:

- **Cloudflare Access on the web UI — still a manual step.** This is a
  zero-trust / zone-level setting configured in the Cloudflare dashboard
  (Access → Applications, email allow-list), not application code, and it
  has NOT been done yet. Nothing in the codebase gates the frontend; until
  Access is turned on in the dashboard, the UI is open.
- **Local sync CLI** — still not started. Reuse the append-only ulid
  scheme so sync stays a conflict-free set union.
- **Retrieval for chat** — still the naive full-dump; see CLAUDE.md.

Deployment prerequisites for `/mcp`: a GitHub OAuth App, the secrets
`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `COOKIE_ENCRYPTION_KEY`, the
`ALLOWED_GITHUB_USER` var, and the `OAUTH_KV` namespace (all noted in
wrangler.toml).
