import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import { appendDocSchema } from "./schema";
import { DocsService } from "./service";

// Mounted at /api/projects, alongside memory/share routes — authenticated
// the same loose way the rest of /api/* is (see CLAUDE.md's MCP hostname
// guard notes for the one exception).
export const docsRoutes = new Hono<{ Bindings: Bindings }>();

docsRoutes.get("/:slug/docs", async (c) => {
  const service = new DocsService(c.env);
  const filenames = await service.list(c.req.param("slug"));
  return c.json({ filenames });
});

docsRoutes.get("/:slug/docs/:filename", async (c) => {
  const service = new DocsService(c.env);
  const content = await service.read(c.req.param("slug"), c.req.param("filename"));
  if (content === null) return c.json({ error: "Not found" }, 404);

  return new Response(content, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
});

docsRoutes.post("/:slug/docs", zValidator("json", appendDocSchema), async (c) => {
  const service = new DocsService(c.env);
  const { filename, content } = c.req.valid("json");
  try {
    await service.append(c.req.param("slug"), filename, content);
    return c.json({ ok: true }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Unknown project") ? 404 : 500;
    return c.json({ error: message }, status);
  }
});
