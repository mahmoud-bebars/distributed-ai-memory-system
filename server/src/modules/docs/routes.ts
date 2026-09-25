import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import { appendDocSchema, updateDocSchema } from "./schema";
import { DocsService } from "./service";

function docErrorStatus(message: string): 404 | 500 {
  if (message.startsWith("Unknown project")) return 404;
  if (message.startsWith("Unknown doc")) return 404;
  return 500;
}

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

// Full-overwrite replace — distinct from the append semantics of POST above.
// Mirrors DocsService.update: the browser chat's Approve action for a
// proposed update_doc edit calls this, not the POST route, so an "edit" is
// never silently turned into another append.
docsRoutes.put("/:slug/docs/:filename", zValidator("json", updateDocSchema.pick({ content: true })), async (c) => {
  const service = new DocsService(c.env);
  const { content } = c.req.valid("json");
  try {
    await service.update(c.req.param("slug"), c.req.param("filename"), content);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, docErrorStatus(message));
  }
});

docsRoutes.delete("/:slug/docs/:filename", async (c) => {
  const service = new DocsService(c.env);
  try {
    await service.delete(c.req.param("slug"), c.req.param("filename"));
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, docErrorStatus(message));
  }
});
