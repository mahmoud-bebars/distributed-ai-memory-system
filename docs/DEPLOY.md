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

1. Get your D1 database id and your KV namespace id, and paste them into
   server/wrangler.toml (run these from `server/`):
   wrangler d1 info dams_db
   # copy the uuid into database_id in wrangler.toml
   wrangler kv namespace create OAUTH_KV
   # copy the id into the OAUTH_KV [[kv_namespaces]] block in wrangler.toml

2. Apply the schema to the remote database (not just --local this time), from
   the repo root:
   npm run db:migrate:remote

3. Set the Anthropic key as a secret (never in wrangler.toml or committed
   files) — from `server/`:
   wrangler secret put ANTHROPIC_API_KEY

4. Deploy — from the repo root. This builds the client workspace into
   `client/dist` and then runs `wrangler deploy` in `server/`, which serves
   that build as static assets:
   npm run deploy

5. Point your custom domain at it: uncomment the `routes` block in
   server/wrangler.toml and set `pattern` to your own domain (e.g.
   `memory.example.com`), then `npm run deploy` again from the repo root.
   Cloudflare will prompt you to confirm the DNS record if it isn't already
   proxied through your zone.

6. Smoke test (substitute your own domain):
   curl https://memory.example.com/api
   curl -X POST https://memory.example.com/api/projects \
     -H 'content-type: application/json' \
     -d '{"slug":"ghoraf","title":"Ghoraf"}'
