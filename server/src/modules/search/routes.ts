import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { slugSchema } from "../projects/schema";
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

// POST /api/search/reindex — admin only (gated in index.ts). Re-indexes every
// project that's opted in to global search, or just `{ "project": "<slug>" }`
// (which must be opted in). Starts the backfill Workflow (or the inline
// fallback when no Workflows binding is set). The body is optional.
const reindexBodySchema = z.object({ project: slugSchema.optional() });

searchRoutes.post("/reindex", async (c) => {
  const body = reindexBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "Invalid body" }, 400);
  try {
    const result = await new SearchService(c.env, c.executionCtx).startReindex(body.data.project);
    return c.json(result, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, message.startsWith("Project isn't included") ? 409 : 500);
  }
});
