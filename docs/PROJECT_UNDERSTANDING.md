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
all from one deployment on a single custom domain. Matches how Hoqooqi
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

## Auth plan (superseded 2026-09-28 — see "Current status" and CLAUDE.md)

Original plan, kept here for history: gate the web UI with Cloudflare
Access alone (no in-Worker check) and gate `/mcp` separately with
`@cloudflare/workers-oauth-provider` + GitHub as the upstream identity
provider. That shipped, but left `/api/*` with no Worker-side auth at all
— which turned out to matter the day Access itself was found
misconfigured wide open on the share hostname (see CLAUDE.md's in-code
host-guard note). The whole app now uses one mechanism instead — see
"Current status" below and CLAUDE.md's "MCP + token auth conventions".

## Current status

REST API (projects CRUD, memory read/append, plus a raw
`GET /api/projects/:slug/memory/raw` that streams the R2 `memory.jsonl`
object byte-for-byte for backup/export) and chat-with-memory are built
and deployed.

The web UI (`client/`) got a full pass: shadcn/ui components, a persistent
project sidebar instead of list/detail toggling, a Graph/Entries/Chat/
Prompts tab layout per project, an interactive memory graph (drag, zoom,
search, click-to-inspect side panel), a raw Entries table with type/text
filtering, a manual refresh control, and an Export control (pretty JSON
of the fetched view, or the byte-for-byte raw `.jsonl` from the raw
route).

The **MCP layer is built** (`server/src/modules/mcp`). `/mcp` exposes seven
tools — `list_projects`, `read_memory`, `append_memory`, `update_entity`,
`append_doc`, `update_doc`, `delete_doc`, `ask_memory` — as thin wrappers
over the existing services (no `create_project`; project creation stays
REST-only). It runs stateless per the MCP 2026-07-28 spec: no Durable
Object, just a throwaway server + Web Standard Streamable HTTP transport
per request.

**Auth was rebuilt 2026-09-28** (`server/src/modules/tokens`), replacing
both GitHub OAuth on `/mcp` and bare reliance on Cloudflare Access for
`/api/*`, with one mechanism: hashed `dams_…` bearer tokens in D1, scoped
`admin`/`read_write`/`read_only`, create/list/revoke from a web UI Tokens
page. Every route is gated in code now (`requireApiAuth`, applied in
`server/src/index.ts`) — there's no longer a route implicitly relying on
whatever sits in front of the domain. See CLAUDE.md's "MCP + token auth
conventions" for the mechanism.

**Cloudflare Access is still on** for the main deployment domain, as an
*additional* edge-level layer — the Worker no longer depends on it for
correctness, but it hasn't been removed. The `SHARE_HOSTNAME` domain (see
CLAUDE.md and `server/src/lib/bindings.ts`) is the one hostname
deliberately left outside it, gated instead by a path-scoped Access bypass
policy (`/mcp`, `/.well-known/*`, `/share/*`, `/api/share/*` — configured
in the dashboard, not in this repo; the OAuth-only paths this list used to
carry — `/authorize`, `/token`, `/register`, `/callback` — no longer exist).

**Shareable read-only project links are now built** (`server/src/modules/shares`,
`client/src/components/ShareView.tsx`/`ShareDialog.tsx`). A project owner
generates an unguessable token from the authenticated app; anyone with
`https://<SHARE_HOSTNAME>/share/:token` sees that one project's
Graph and Entries tabs, read-only, with no login and no visibility into
any other project. This is why the token endpoint
(`GET /api/share/:token/memory`) and the `/share/*` frontend route needed
adding to that same dashboard bypass policy — see CLAUDE.md's "Shareable
read-only links" section for the full mechanism.

The web app also now has an in-app **Guide** page (MCP connect command,
token instructions, live tool list), a **Tokens** page (admin-scoped
sessions only — create/list/revoke), a **Login** page (paste a token, sets
the session cookie), and a per-project **Prompts** tab (seed/sync templates
for driving a Claude Code session to write memory for a repo) — see
CLAUDE.md's frontend-conventions section.

Still outstanding:

- **Local sync CLI** — still not started. Reuse the append-only ulid
  scheme so sync stays a conflict-free set union.
- **Retrieval for chat** — still the naive full-dump; see CLAUDE.md.

Deployment prerequisite for auth: one secret, `DAMS_ADMIN_TOKEN` (see
CLAUDE.md's "MCP + token auth conventions" and `server/wrangler.toml.example`)
— the break-glass credential used to log in once and create real tokens.
