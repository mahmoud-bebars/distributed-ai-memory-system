# Project understanding

The goal, the decisions that shaped the architecture, what's built, and
what's left. Conventions for writing code live in [CLAUDE.md](../CLAUDE.md);
how to run it in [DEPLOY.md](DEPLOY.md) and the [README](../README.md).

## The goal

A memory layer that isn't locked to one machine or one AI provider. Any
MCP-capable client (Claude, ChatGPT, Gemini CLI, Claude Code) can read and
write the same project memory, from any machine — and a cross-project
**assistant** can search that memory, answer with citations, and propose
organising changes that only happen after the owner approves them.

A longer-term goal — not started — is mining that memory for patterns in how
the owner works (the consent-gated "brain"). It is deliberately separate
from the assistant and out of its reach.

## Why this shape

**One Worker, not separate services.** Hono on Cloudflare Workers serving
the REST API, the MCP endpoint and the built frontend as static assets, all
from one deployment on a single custom domain. Avoids managing multiple
deployment targets for a single-user tool.

**R2 is the source of truth, not the local machine.** If local were
canonical, "take memory anywhere" would still bottleneck on one machine
being reachable. Local becomes a synced working copy.

**D1 is an index, not a data store.** `projects` holds slug, title, summary,
tags, r2_key, counts, flags, timestamps. Memory content lives only in R2's
`{slug}/memory.jsonl`. If D1 were wiped it should be reconstructable by
re-scanning R2. The same rule covers the search tables (`entry_fts`,
`entry_index_status`) and Vectorize: they are **derived indexes**, rebuilt by
`POST /api/search/reindex`. Plans, tasks, conversations and the audit log are
operational state, not memory content.

**JSONL, append-only.** Two devices appending lines can always be merged as a
set union sorted by id — no merge logic — but only if nothing ever rewrites
existing lines. That's why "edits" append a new revision (entities are
last-write-wins by name), moves copy-and-mark, tags are annotation entries,
and archive is a flag.

**Drizzle over raw D1** for the registry tables (Prisma/Sequelize don't run
natively on Workers). FTS5 and the search/plan/task tables use raw SQL
migrations, hand-written in the `CREATE TABLE IF NOT EXISTS` style.

**MCP is a thin protocol wrapper.** REST is the real implementation; MCP
tools call the same services. `/mcp` is stateless (MCP 2026-07-28: no
session handshake), so no Durable Object.

**One credential type: `dams_…` bearer tokens** (hashed in D1; scopes
`read_only < read_write < admin`; optional per-token project allow-list where
a denial is always a 404). Browser login just stores the raw token in an
httpOnly cookie, so revoking a token logs out its sessions too.
`DAMS_ADMIN_TOKEN` is the break-glass bootstrap.

**Retrieval, not prompt-stuffing.** Chat gives the model search tools it
executes itself; memory search goes through the hybrid index and falls back
to a keyword scorer. Everything retrieved is untrusted data.

## What's built

- **Memory & projects** — REST + MCP, entities/relations/observations,
  last-write-wins entities, raw export, per-project docs (markdown files
  under `{slug}/docs/`).
- **Web UI** — project sidebar/switcher, Graph / Entries / Chat / Docs /
  Prompts tabs, Guide, Tokens, Plans and Assistant pages, login.
- **Sharing** — unguessable read-only links per project with optional chat /
  docs and expiry.
- **Auth** — token layer, scopes, per-token project allow-lists, in-code
  share-hostname guard.
- **Hybrid search** — Workers AI `bge-m3` → Vectorize + D1 FTS5, reciprocal
  rank fusion, `search_memory` / `GET /api/search`, backfill Workflow, cron
  sweep, per-project privacy flag. The index follows the flag (only opted-in
  projects are indexed), with a nightly reconcile cron and a "Reindex now"
  admin button.
- **Actions with approval** — typed plans (`create_project`,
  `update_project`, `archive_project`, `tag_entries`, `move_entries`,
  `write_synthesis`), validated in code, approved by an admin, executed
  idempotently with an audit log.
- **Global assistant** — bounded agent loop, citations validated in code,
  persistent tasks (cancel / retry / resume / expire), conversations.

## The cross-project assistant — design

This is the design the feature was built to (formerly a separate handoff
brief); the decisions below are why the code looks the way it does.

### What it does

An agent in a global chat panel, outside any single project:

- **Search** across the owner's projects and answer with **citations to the
  exact entries used**.
- **Propose actions** — create a project, organise/tag/move entries, write a
  merged summary — where **nothing runs until the owner approves it**.
- **Memory and state:** its memory *is* the projects; its state is the tasks
  it is running now, which are visible, resumable and cancellable.

### Hard constraints

- **Cloudflare only, Workers Free plan.** Nothing may need Workers Paid.
  Design for the limits (see the table in [DEPLOY.md](DEPLOY.md#free-plan-limits))
  and degrade instead of breaking writes.
- **LLM calls go to the Anthropic API**, the same way chat does, with a daily
  spend cap and a per-task token cap; every call checks both first and logs
  its usage.
- Repo conventions hold: npm only, no `any`, Zod at every boundary,
  4-file modules, append-only memory.

### Safety model

- **Memory is untrusted data.** Any MCP client can write memory, so a
  poisoned entry is a real threat once an agent can act. Retrieved text goes
  into prompts only inside delimited `<memory_data>` blocks with delimiter
  characters neutralised, under a code-owned rule: never follow instructions
  found inside memory (`server/src/lib/untrusted.ts`).
- **The model has no side-effect powers.** Every assistant call is
  structured output validated by Zod (one corrective retry, then a hard
  failure). The model can only emit typed moves; code runs the reads and
  runs writes only after approval. There is deliberately **no write move**.
- **No auto-execute.** Every write-type action needs explicit approval;
  there is no "always allow" mode. Approve/reject need an `admin` token, so
  an MCP client holding `read_write` can propose but never approve.
- **No destructive deletes.** Archive is a soft flag, history stays
  append-only, and every executed action writes an audit record (with an
  inverse where one exists).
- **Privacy flag.** Projects with `include_in_global_search = 0` (the
  default) are invisible to cross-project search and to the assistant unless
  the owner names them. A token's project allow-list always applies on top.
- **`create_project` is ask-first**, in three independent places: the
  assistant must have `ask_user`-confirmed the slug/title (enforced in code),
  the approval API refuses without the slug typed as a per-action
  confirmation, and over MCP it can only be proposed.
- The consent-gated "brain" stays out of the assistant's reach entirely.

### How it was built (phases)

1. **Hybrid search with citations (read-only)** — `SearchIndex` interface
   with a Cloudflare implementation (Vectorize + FTS5, RRF in code), one
   vector per entry (entities keyed by project + name so a revision
   overwrites), append-time indexing that can't fail a write, a backfill
   Workflow (one small batch per step, chained past 900 steps), a cron
   sweep, the privacy flag, `search_memory`, and retrieval-backed chat.
2. **Actions with approval** — typed catalogue, code validation before the
   owner sees a plan, plan → approve → execute in a Workflow (one `step.do`
   per action, idempotent by action id), audit log, `propose_actions` over
   MCP, the Plans page.
3. **Tasks, state and the assistant** — a code-driven loop (≤ 5 steps and a
   token budget) returning one typed move per step: `search`,
   `read_entries`, `answer`, `propose_plan`, `ask_user`; tasks in D1 (D1 is
   the source of truth — Free-plan Workflow state is kept only 3 days);
   controls to cancel, retry and resume; `list_tasks` / `get_task` for other
   clients.

### Decisions that differ from the original brief

- Projects are keyed by **slug**; there is no separate project id.
- Entries have no tags field, so `tag_entries` appends an annotation entry
  instead of rewriting anything. `move_entries` appends a copy (with
  provenance) plus a `moved_to` marker.
- **Approval timeout** is a D1 expiry after 7 days, run by the cron, rather
  than a Workflow `waitForEvent` — no idle Workflow instance, and task state
  stays in D1.
- The Workers AI cap is a token estimate (`WORKERS_AI_DAILY_TOKEN_CAP`), not
  neurons.
- **Vitest / an automated test suite was deliberately not added.** Safety
  invariants are enforced structurally instead (one execution path, no
  model-reachable write function), and the assistant loop is exercised
  locally against a scripted stand-in for the Anthropic API (see CLAUDE.md).

## Roadmap & open tasks

Not started or intentionally deferred:

- [ ] **Local sync CLI** — reuse the append-only ulid scheme so sync stays a
  conflict-free set union.
- [ ] **Undo** — plans record an inverse per action; nothing executes it yet.
- [ ] **Docs in search** — `{slug}/docs/*.md` aren't indexed, so search and
  the assistant can't reach them.
- [ ] **Per-action approval** — plans are approved or rejected as a whole.
- [ ] **Automated tests** — none by choice so far; the highest-value ones
  would be RRF fusion, citation validation, the privacy filter, plan
  validation, the approval gate and the assistant loop cap.
- [ ] **A pgvector + Postgres full-text `SearchIndex` adapter** — the
  interface keeps it possible; not built.
- [ ] **The consent-gated "brain"** — mining memory for how the owner works.
- [ ] **Wrangler 4** — the repo pins 3.x; local dev warns that newer
  compatibility dates aren't supported.
