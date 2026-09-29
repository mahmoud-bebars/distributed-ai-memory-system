# First deploy

`server/` is the Cloudflare Worker (Hono + D1 + R2), `client/` is the
frontend it serves. Both are npm workspaces under one root `package.json`.
Run `npm install` from the repo root once; the rest is split between root
commands (which delegate to the right workspace) and direct `wrangler` CLI
calls, which need `wrangler.toml` in the working directory — so those run
from `server/`.

0. wrangler.toml is git-ignored (it holds this account's real D1/KV resource
   ids) — copy the template first:
   cp server/wrangler.toml.example server/wrangler.toml

1. Get your D1 database id and paste it into server/wrangler.toml (run this
   from `server/`):
   wrangler d1 info dams_db
   # copy the uuid into database_id in wrangler.toml

2. Apply the schema to the remote database (not just --local this time), from
   the repo root:
   npm run db:migrate:remote

3. Set secrets (never in wrangler.toml or committed files) — from `server/`:
   wrangler secret put ANTHROPIC_API_KEY
   wrangler secret put DAMS_ADMIN_TOKEN
   # DAMS_ADMIN_TOKEN is the break-glass/bootstrap credential for the token
   # auth layer (see CLAUDE.md's "MCP + token auth conventions") — any
   # random string. Log into the web UI with it once, create a real
   # `admin`-scoped token from the Tokens page, and prefer that afterward.

3b. Optional — hybrid semantic search. The `[ai]`, `[[vectorize]]` and
   `[[workflows]]` blocks in wrangler.toml.example need a Vectorize index to
   exist before `wrangler deploy` (or delete those blocks for keyword-only
   search). From `server/`:
   wrangler vectorize create dams-memory --dimensions=1024 --metric=cosine
   wrangler vectorize create-metadata-index dams-memory --property-name=projectSlug --type=string
   After the first deploy, backfill existing entries once:
   POST /api/search/reindex with an admin token (see README).

4. Deploy — from the repo root. This builds the client workspace into
   `client/dist` and then runs `wrangler deploy` in `server/`, which serves
   that build as static assets:
   npm run deploy

5. Point your custom domain at it: uncomment the `routes` block in
   server/wrangler.toml and set `pattern` to your own domain (e.g.
   `memory.example.com`), then `npm run deploy` again from the repo root.
   Cloudflare will prompt you to confirm the DNS record if it isn't already
   proxied through your zone.

6. Smoke test (substitute your own domain and DAMS_ADMIN_TOKEN value):
   curl https://memory.example.com/api
   curl -X POST https://memory.example.com/api/projects \
     -H 'content-type: application/json' \
     -H 'authorization: Bearer <your DAMS_ADMIN_TOKEN>' \
     -d '{"slug":"ghoraf","title":"Ghoraf"}'
   # /api/* requires a credential now — either this bearer header, or the
   # session cookie the web UI sets after you log in at "/" with a token.

## Continuous deployment (Cloudflare Workers Builds)

Optional. Connects the Worker to a GitHub branch so every push deploys —
Cloudflare's own Git integration, not GitHub Actions.

Cloudflare Workers Builds checks out a fresh clone of your repo for every
build, and `server/wrangler.toml` is deliberately not in that clone (step 0
above — it's git-ignored so a fork of this repo can't accidentally deploy
onto the original author's D1 database or domain). `server/scripts/render-wrangler-toml.sh`
reconstructs it at build time from `wrangler.toml.example`, filling in your
two account-specific values from Cloudflare Build's own environment
variables (set in the dashboard, never committed — neither value is
actually sensitive, they're just not something a fork should inherit by
default).

1. **Workers & Pages → (this Worker) → Settings → Builds → Connect to Git.**
   Authorize Cloudflare's GitHub App on this repo if you haven't already,
   pick the repo and the branch that should auto-deploy (e.g. `main`).

2. Set (leave the Advanced "Path" field at its default, `/` — the commands
   below don't depend on it, since Workers Builds' exact working-directory
   semantics for that field aren't worth relying on):
   - **Build command**:
     `npm install && npm run build && bash server/scripts/render-wrangler-toml.sh`
   - **Deploy command**: `npx wrangler deploy --config server/wrangler.toml`

   Both run from the repo root regardless of Path, which is also what
   `npm install` needs anyway for the two workspaces (`client`/`server`) to
   link correctly. `wrangler deploy --config` resolves the `[assets]
   directory = "../client/dist"` path relative to wrangler.toml's own
   location either way, so this works whether Path is `/` or `/server`.

3. Add two **Build variables** (plain, not secrets):
   - `WRANGLER_D1_DATABASE_ID` — from `wrangler d1 info dams_db`
   - `WRANGLER_CUSTOM_DOMAIN` — e.g. `memory.example.com`

4. The Worker's actual secrets (`ANTHROPIC_API_KEY`, `DAMS_ADMIN_TOKEN`) are
   already attached to the Worker itself via `wrangler secret put` (step 3
   above) — they persist independently of how a deploy is triggered, so
   Workers Builds doesn't need them reconfigured.

D1 migrations are **not** run automatically by this pipeline — `wrangler
d1 migrations apply` still needs `npm run db:migrate:remote` run by hand
after adding a new migration file, same as any other deploy.
