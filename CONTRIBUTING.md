# Contributing

Thanks for taking a look at this project. It's a small, personal-scale
Cloudflare Worker (Hono + D1 + R2) with a React/Vite frontend — contributions
are welcome, but please read this before opening a PR.

## Before you start

For anything beyond a small fix, open an issue first describing what you
want to change and why. This project has some deliberate, opinionated
constraints (see below) — checking first saves you from building something
that doesn't fit.

## Project conventions

These are enforced in review, not just style preferences:

- **npm only** — never yarn or pnpm.
- **No Express, no Next.js** — this is Hono on Cloudflare Workers.
- **No `any` in TypeScript** — if a type is genuinely unknown, use
  `unknown` and narrow it.
- **Zod validation at every route boundary** — no unvalidated
  `c.req.json()`.
- **Every backend module follows the 4-file pattern**: `schema.ts` (Zod +
  types), `service.ts` (business logic, D1/R2 access), `routes.ts` (Hono
  handlers), `index.ts` (barrel export). Don't collapse these into one
  file, even for small modules.
- **R2 is the source of truth** for memory content; D1 is an index/registry
  only — never store data in D1 that isn't reconstructable from R2.
- **`memory.jsonl` is append-only.** Never rewrite history in place.

The full, current set of architectural rules lives in
[CLAUDE.md](CLAUDE.md) — read it before making non-trivial changes,
especially to the memory storage model, the MCP layer, or sharing. It's
kept up to date as the source of truth; this file won't duplicate it.

See [docs/](docs/) for architecture and design background:
[docs/PROJECT_UNDERSTANDING.md](docs/PROJECT_UNDERSTANDING.md) for the
overall goal and shape, [docs/DESIGN.md](docs/DESIGN.md) for the frontend's
visual system.

## Local setup

This is an npm workspaces monorepo (`client/` + `server/`) with one root
`package.json` — a single `npm install` at the repo root installs both.

```
cp server/wrangler.toml.example server/wrangler.toml   # fill in your own D1/KV ids — see docs/DEPLOY.md
cp server/.dev.vars.example server/.dev.vars            # local secrets for `wrangler dev`
npm install
npm run db:migrate:local
npm run dev                # Worker on :8787 (server workspace)

npm run dev:client         # frontend on :5173, proxies /api to :8787
```

## Before opening a PR

```
npm run typecheck
npm run build     # builds the client workspace; must build cleanly
```

There's no automated test suite yet — manually verify the paths your
change touches (the affected REST routes and/or the UI in a browser).

- Keep PRs focused on one change; don't mix refactors with feature work.
- Follow the existing module structure and naming conventions rather than
  introducing new patterns.
- If you touch a data shape (memory entries, share links, DB schema),
  check [CLAUDE.md](CLAUDE.md)'s "Data model rules" section — several of
  these shapes have backward-compatibility constraints that aren't
  obvious from the code alone.
- DB schema changes need a hand-written migration in `server/migrations/`,
  numbered to follow on from the last one — see the note in
  [CLAUDE.md](CLAUDE.md) about why `drizzle-kit generate` doesn't work
  cleanly in this repo.

## Reporting bugs / requesting features

Open a GitHub issue with steps to reproduce (for bugs) or the use case
(for features). This is a side project maintained in spare time, so
response times will vary — please be patient.

## Security

If you find a security issue (auth bypass, data exposure, etc.), please
do not open a public issue. Reach out privately first so it can be fixed
before details are public.
