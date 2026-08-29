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
