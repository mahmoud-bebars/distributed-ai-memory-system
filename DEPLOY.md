# First deploy

Run from the repo root, in order.

1. Get your D1 database id and paste it into wrangler.toml:
   wrangler d1 info dams_db
   # copy the uuid into database_id in wrangler.toml

2. Apply the schema to the remote database (not just --local this time):
   npm run db:migrate:remote

3. Set the Anthropic key as a secret (never in wrangler.toml or committed files):
   wrangler secret put ANTHROPIC_API_KEY

4. Build the frontend — the Worker serves app/dist as static assets, so it
   must exist before deploying:
   cd app && npm install && npm run build && cd ..

5. Deploy:
   npm run deploy

6. Point the custom domain at it: uncomment the `routes` block in
   wrangler.toml (memory.mahmoudbebars.dev), then `npm run deploy` again.
   Cloudflare will prompt you to confirm the DNS record if it isn't already
   proxied through your zone.

7. Smoke test:
   curl https://memory.mahmoudbebars.dev/api
   curl -X POST https://memory.mahmoudbebars.dev/api/projects \
     -H 'content-type: application/json' \
     -d '{"slug":"ghoraf","title":"Ghoraf"}'
