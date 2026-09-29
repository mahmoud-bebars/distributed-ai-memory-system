# Deploy

`server/` is the Cloudflare Worker (Hono + D1 + R2), `client/` is the
frontend it serves. Both are npm workspaces under one root `package.json`.
Run `npm install` from the repo root once; the rest is split between root
`npm run` commands (which delegate to the right workspace) and direct
`wrangler` calls, which need `wrangler.toml` in the working directory — so
those run from `server/`.

Everything here runs on the **Workers Free plan** — see
[Free-plan limits](#free-plan-limits) for what that means in practice.

## Prerequisites

- A Cloudflare account and `npx wrangler login`
- An Anthropic API key (chat, `ask_memory` and the assistant call it)
- Optional: a domain on Cloudflare for a custom hostname

## First deploy

All `wrangler` commands below run from `server/`.

**0. Config.** `wrangler.toml` is git-ignored (it holds your account's
resource ids), so copy the template:

```bash
cp server/wrangler.toml.example server/wrangler.toml
```

**1. Create the D1 database and R2 bucket** (names match the template):

```bash
npx wrangler d1 create dams_db          # copy the uuid into database_id in wrangler.toml
npx wrangler r2 bucket create dmas
```

**2. Apply the schema to the remote database** (from the repo root; runs
every migration in `server/migrations/`, currently `0001`–`0009`):

```bash
npm run db:migrate:remote
```

**3. Set secrets** (never in `wrangler.toml` or committed files):

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put DAMS_ADMIN_TOKEN   # any long random string
```

`DAMS_ADMIN_TOKEN` is the break-glass bootstrap credential for the token
auth layer (see CLAUDE.md's "MCP + token auth conventions"): log into the
web UI with it once, create a real `admin` token on the Tokens page, and
prefer that afterwards.

**4. Semantic search (optional but recommended).** The template declares a
Workers AI binding and a Vectorize binding. Create the index first —
`wrangler deploy` fails if a bound index doesn't exist. bge-m3 is
1024-dimensional, so the dimensions must match:

```bash
npx wrangler vectorize create dams-memory --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index dams-memory --property-name=projectSlug --type=string
```

Don't want it? Delete the block between `# >>> semantic-search` and
`# <<< semantic-search` in your `wrangler.toml` (or set
`WRANGLER_DISABLE_SEMANTIC_SEARCH=1` in CI, see below). Search then runs
keyword-only on D1 FTS5; nothing else changes.

**5. Deploy** (from the repo root — builds the client, then `wrangler
deploy`):

```bash
npm run deploy
```

**6. Custom domain (optional).** Uncomment the `routes` block in
`server/wrangler.toml`, set `pattern` to your domain (e.g.
`memory.example.com`), and `npm run deploy` again. Cloudflare prompts to
confirm the DNS record if it isn't already proxied through your zone.

**7. Post-deploy checklist**

```bash
# health
curl https://memory.example.com/api

# create a first project (any bearer token with read_write+)
curl -X POST https://memory.example.com/api/projects \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <DAMS_ADMIN_TOKEN>' \
  -d '{"slug":"ghoraf","title":"Ghoraf"}'

# index projects that are already opted in (admin token). Optional: the nightly
# cron does this on its own, and the dashboard's "Reindex now" button is the
# same call. Pass {"project":"<slug>"} to reindex just one.
curl -X POST https://memory.example.com/api/search/reindex \
  -H 'authorization: Bearer <admin token>'

# then confirm: vectors:true, everything indexed
curl https://memory.example.com/api/search/status \
  -H 'authorization: Bearer <admin token>'
```

Then, in the web UI: create scoped tokens for your AI clients (Tokens
page), and turn on **Include in global search** for each project the
assistant and `search_memory` may read (Edit project — it's off by
default). **The search index follows that switch:** only opted-in projects
are indexed (which also keeps you inside Vectorize's free-plan quota).
Turning it on indexes the project automatically; turning it off, or
archiving, removes it from the index. A project you *name explicitly* in a
search but that isn't opted in is scanned directly from its log instead
(keyword scoring, no vectors).

### Keeping the index in sync

| What | When | Effect |
|---|---|---|
| Append-time indexing | every `append_memory` / plan action, opted-in projects only | The new entry is searchable within seconds; can never fail the write |
| Toggle the switch | Edit project | On → the project is indexed (Workflow); off / archive → removed from the index |
| **Nightly reconcile** (cron `0 3 * * *`) | 03:00 UTC | Purges anything that shouldn't be indexed and re-indexes any opted-in project never fully indexed or changed since (`projects.search_indexed_at` vs `updated_at`). Idle projects cost nothing |
| 15-minute sweep (cron `*/15 * * * *`) | every 15 min | Retries entries whose embedding failed or was paused by the Workers AI budget |
| **Reindex now** | admin button on the dashboard (all) and in a project's menu (one), or `POST /api/search/reindex` | Immediate full re-index of opted-in projects |

## Continuous deployment (Cloudflare Workers Builds)

Optional. Connects the Worker to a GitHub branch so every push deploys —
Cloudflare's own Git integration, not GitHub Actions.

Workers Builds checks out a fresh clone for every build, and
`server/wrangler.toml` isn't in it (it's git-ignored so a fork can't
accidentally deploy onto the original author's D1 database or domain).
`server/scripts/render-wrangler-toml.sh` reconstructs it from
`wrangler.toml.example` at build time, filling in your account-specific
values from build variables.

1. **Workers & Pages → (this Worker) → Settings → Builds → Connect to Git.**
   Authorize Cloudflare's GitHub App, pick the repo and the branch that
   should auto-deploy (e.g. `main`).

2. Set the build and deploy commands. **They depend on the Advanced "Path"
   (root directory) field** — both commands run from that directory, and
   the deploy command fails with `Could not read file …/server/server/wrangler.toml`
   if the `--config` path doesn't match it:

   | Path | Build command | Deploy command |
   |---|---|---|
   | `/` (repo root) | `npm install && npm run build && bash server/scripts/render-wrangler-toml.sh` | `npx wrangler d1 migrations apply DAMS_DB --remote --config server/wrangler.toml && npx wrangler deploy --config server/wrangler.toml` |
   | `/server` | `cd .. && npm install && npm run build && cd server && bash scripts/render-wrangler-toml.sh` | `npx wrangler d1 migrations apply DAMS_DB --remote && npx wrangler deploy` |

   The build must run from the repo root for `npm install` to link the two
   workspaces (hence the `cd ..` with Path `/server`), and it writes
   `wrangler.toml` into `server/`; the deploy command just has to find that
   file from wherever it runs.

   The deploy command applies any pending D1 migrations **before** shipping
   the code that needs them (it's a no-op when there's nothing new, and each
   migration is applied exactly once; a failed migration stops the deploy).
   If you'd rather run migrations by hand, use just the `wrangler deploy`
   half and run `npm run db:migrate:remote` yourself before pushing a change
   that adds a migration.

3. **Build variables** (plain, not secrets):

   | Variable | Required | Value |
   |---|---|---|
   | `WRANGLER_D1_DATABASE_ID` | yes | from `wrangler d1 info dams_db` |
   | `WRANGLER_CUSTOM_DOMAIN` | yes | e.g. `memory.example.com` |
   | `WRANGLER_DISABLE_SEMANTIC_SEARCH` | no | `1` to drop the AI/Vectorize bindings (keyword-only search) so the build doesn't need a Vectorize index |

4. The Worker's secrets (`ANTHROPIC_API_KEY`, `DAMS_ADMIN_TOKEN`) live on
   the Worker itself (step 3 above) and persist independently of how a
   deploy is triggered — Workers Builds needs nothing extra. The Vectorize
   index (step 4) is also created once, outside CI.

The build's API token needs D1 edit permission for the migrations step (the
default Workers Builds token has it).

## Upgrading an existing deployment

1. Pull the new code. If it adds files under `server/migrations/`, they run
   with the deploy command above — or by hand with
   `npm run db:migrate:remote` **before** deploying.
2. If it adds new bindings to `wrangler.toml.example` (e.g. `[[vectorize]]`,
   `[[workflows]]`, `[triggers]`), copy them into your own `wrangler.toml`
   (CI-rendered deployments get them automatically) and create any resource
   they need first.
3. Deploy. If search indexing changed, click **Reindex now** (or wait for
   the nightly reconcile).

Migrations are additive and never drop data. The search tables are derived
indexes: if one is ever lost, `POST /api/search/reindex` rebuilds it from R2.

## Configuration reference

**Secrets** (`wrangler secret put`, or `server/.dev.vars` locally):

| Name | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Chat, `ask_memory`, the assistant |
| `DAMS_ADMIN_TOKEN` | Break-glass bootstrap admin credential |

**Bindings** (`wrangler.toml`):

| Binding | Type | Required | Purpose |
|---|---|---|---|
| `DAMS_DB` | D1 | yes | Registry, tokens, shares, search index, plans, tasks |
| `DAMS_BUCKET` | R2 | yes | `memory.jsonl` + docs — source of truth |
| `ASSETS` | Assets | yes | The built frontend |
| `AI` | Workers AI | no | bge-m3 embeddings for semantic search |
| `VECTORIZE` | Vectorize | no | Vector index (`dams-memory`, 1024-d cosine) |
| `SEARCH_WORKFLOW` | Workflow | no | Search backfill (falls back to inline) |
| `ACTIONS_WORKFLOW` | Workflow | no | Approved-plan execution (falls back to inline) |
| cron `*/15 * * * *` | Trigger | no | Retries paused/failed indexing; expires stale plans; syncs task status |
| cron `0 3 * * *` | Trigger | no | Nightly search-index reconcile (must match `RECONCILE_CRON` in `server/src/index.ts`) |

Every optional binding degrades gracefully when absent — none can make a
memory write fail.

**Vars** (`[vars]` in `wrangler.toml`, all optional):

| Name | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `production` | Gates the session cookie's `Secure` flag (`development` locally) |
| `SHARE_HOSTNAME` | unset | Second hostname left outside Cloudflare Access for share links / `/mcp` |
| `LLM_DAILY_TOKEN_CAP` | `500000` | Anthropic tokens per UTC day, across chat + assistant |
| `LLM_TASK_TOKEN_CAP` | `100000` | Anthropic tokens per single chat turn / assistant task |
| `WORKERS_AI_DAILY_TOKEN_CAP` | `5000000` | Estimated embedding tokens per UTC day |

## Cloudflare Access (if you use it)

Access, if you keep it in front of the domain, is now an *additional*
edge-level layer — every route is authenticated in code, the Worker doesn't
depend on it. But it must **bypass** these paths, or MCP clients (which
can't complete an interactive Access login) and share-link recipients
(who have no Access identity) get an Access redirect instead of the Worker:

`/mcp`, `/.well-known/*`, `/share/*`, `/api/share/*`

That policy lives in the Cloudflare dashboard, not this repo. See
CLAUDE.md's "Shareable read-only links" section (including the in-code host
guard for `SHARE_HOSTNAME`).

## Free-plan limits

The design stays inside the Workers Free plan and degrades instead of
breaking writes when it doesn't fit:

| Limit | How the app handles it |
|---|---|
| 10 ms CPU per request / Workflow step | Backfill is one small batch (≈25 entries) per step; time spent waiting on D1/AI/Vectorize doesn't count |
| 1,024 steps per Workflow instance | Backfill stops at 900 steps and chains a fresh instance |
| Workflow state kept 3 days | Task and plan state lives in D1; Workflows only carry out work |
| Vectorize: 5M stored dimensions (≈ 4,900 entries at 1024-d) | Beyond that, new entries stay keyword-searchable |
| Workers AI: 10k Neurons/day | `WORKERS_AI_DAILY_TOKEN_CAP` pauses embedding; entries stay pending and the cron resumes them |
| D1 free limits | Search sweep and cron work is bounded per run |
| Anthropic spend (not a Cloudflare limit) | `LLM_DAILY_TOKEN_CAP` / `LLM_TASK_TOKEN_CAP`, checked before every call and logged after |

## Troubleshooting

- **Deploy fails with a Vectorize error** — the `dams-memory` index doesn't
  exist yet (step 4), or you want keyword-only search
  (`WRANGLER_DISABLE_SEMANTIC_SEARCH=1`).
- **`search/status` says `vectors: false`** — the `AI`/`VECTORIZE` bindings
  aren't in the deployed config; check `wrangler.toml`.
- **Search returns nothing for a project** — it's off for global search
  (turn the switch on, or name it explicitly), or hasn't been indexed yet
  (click **Reindex now**, or wait for the nightly reconcile).
- **Plan stuck `running`** — resume it from the assistant's task list or
  `POST /api/plans/:id/resume` (admin).
- **Chat/assistant says the budget is spent** — raise `LLM_DAILY_TOKEN_CAP`
  or wait for the UTC day to roll over.
- **MCP client sees a 401/redirect** — a token problem, or Cloudflare Access
  isn't bypassing `/mcp` (see above).
