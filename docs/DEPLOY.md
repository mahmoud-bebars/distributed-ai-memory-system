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
