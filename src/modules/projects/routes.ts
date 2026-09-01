import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import { appendMemorySchema, createProjectSchema } from "./schema";
import { ProjectsService } from "./service";

export const projectsRoutes = new Hono<{ Bindings: Bindings }>();

projectsRoutes.get("/", async (c) => {
  const service = new ProjectsService(c.env);
  return c.json(await service.list());
});

projectsRoutes.post("/", zValidator("json", createProjectSchema), async (c) => {
  const service = new ProjectsService(c.env);
  try {
    const project = await service.create(c.req.valid("json"));
    return c.json(project, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Project already exists") ? 409 : 500;
    return c.json({ error: message }, status);
  }
});

projectsRoutes.get("/:slug/memory", async (c) => {
  const service = new ProjectsService(c.env);
  const entries = await service.readMemory(c.req.param("slug"));
  return c.json(entries);
});

// Streams the raw R2 object bytes (the real memory.jsonl) rather than
// re-serialized JSON — a byte-for-byte copy for backup/portability.
projectsRoutes.get("/:slug/memory/raw", async (c) => {
  const service = new ProjectsService(c.env);
  const slug = c.req.param("slug");
  const object = await service.readMemoryRaw(slug);
  if (!object) return c.json({ error: `Unknown project: ${slug}` }, 404);

  return new Response(object.body, {
    headers: {
      "content-type": "application/x-ndjson",
      "content-disposition": `attachment; filename="${slug}-memory.jsonl"`,
    },
  });
});

projectsRoutes.post(
  "/:slug/memory",
  zValidator("json", appendMemorySchema),
  async (c) => {
    const service = new ProjectsService(c.env);
    const { entry } = c.req.valid("json");
    await service.appendMemory(c.req.param("slug"), entry);
    return c.json({ ok: true }, 201);
  }
);
