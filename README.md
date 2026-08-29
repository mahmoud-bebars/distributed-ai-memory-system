# distributed-ai-memory-system

A personal, cross-provider memory server: one Cloudflare Worker that lets
any MCP-capable AI client (Claude, ChatGPT, Gemini CLI, Claude Code) read
and write structured memory for your projects, backed by D1 (registry) and
R2 (per-project JSONL blobs). Ships with a small web UI for browsing and
chatting with a project's memory via the Anthropic API.

Deployed at `memory.mahmoudbebars.dev`.

## Stack

- Hono on Cloudflare Workers (no Express, no Next.js)
- D1 via Drizzle ORM — registry/index of projects
- R2 — raw `memory.jsonl` per project, append-only
- Zod validation at every route boundary
- React + Vite + Tailwind frontend, served as Workers Static Assets from
  the same deployment (no separate Pages project)

## Local development

```
npm install
npm run db:migrate:local
npm run dev            # Worker on :8787

cd app && npm install && npm run dev   # frontend on :5173, proxies /api to :8787
```

## First deploy

See DEPLOY.md.

## Project structure

```
src/
  index.ts              Worker entry — mounts /api routes, falls back to ASSETS
  lib/bindings.ts        Shared Env/Bindings type (D1, R2, ASSETS, API key)
  db/schema.ts            Drizzle table definitions
  modules/
    projects/            4-file module: schema.ts, service.ts, routes.ts, index.ts
    chat/                 Same pattern — Anthropic API chat over a project's memory
migrations/               D1 migrations (wrangler-managed)
app/                       Vite/React frontend, built into app/dist and served by the Worker
```

## Status

See PROJECT_UNDERSTANDING.md for the full architecture and what's still
ahead (MCP tool layer, OAuth, sync CLI).
