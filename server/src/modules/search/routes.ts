import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import type { TokenAuth } from "../tokens";
import { searchQuerySchema } from "./schema";
import { SearchService } from "./service";

export const searchRoutes = new Hono<{ Bindings: Bindings; Variables: { tokenAuth: TokenAuth } }>();

// GET /api/search?q=...&projects=a,b&topK=8 — hybrid search across the
// projects this token may see (and that opted in to global search, unless
// named explicitly in `projects`).
searchRoutes.get("/", zValidator("query", searchQuerySchema), async (c) => {
  const { q, projects, topK } = c.req.valid("query");
  const { hits, unknown } = await new SearchService(c.env).search(c.get("tokenAuth"), {
    query: q,
    projectSlugs: projects,
    topK,
  });
  if (unknown.length > 0) return c.json({ error: `Unknown project: ${unknown[0]}` }, 404);
  return c.json({ hits });
});

// Index health: how many entries are indexed / pending / keyword-only.
searchRoutes.get("/status", async (c) => {
  return c.json(await new SearchService(c.env).status());
});

// POST /api/search/reindex — admin only (gated in index.ts). Starts the
// backfill Workflow (or the inline fallback when no Workflows binding is set).
searchRoutes.post("/reindex", async (c) => {
  const mode = await new SearchService(c.env, c.executionCtx).startReindex();
  return c.json({ started: mode }, 202);
});
