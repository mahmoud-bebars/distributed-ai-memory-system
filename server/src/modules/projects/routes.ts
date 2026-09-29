import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import { canAccessProject, type TokenAuth } from "../tokens";
import { appendMemorySchema, createProjectSchema, updateProjectSchema } from "./schema";
import { ProjectsService } from "./service";

export const projectsRoutes = new Hono<{ Bindings: Bindings; Variables: { tokenAuth: TokenAuth } }>();

// The only two routes on this collection root, not covered by index.ts's
// /api/projects/:slug/* guard (which needs a slug to check) — list is
// filtered to what this token can see, create is refused outright for a
// restricted token rather than silently scoping the new project to it.
projectsRoutes.get("/", async (c) => {
  const auth = c.get("tokenAuth");
  const service = new ProjectsService(c.env);
  const all = await service.list();
  return c.json(all.filter((project) => canAccessProject(auth, project.slug)));
});

projectsRoutes.post("/", zValidator("json", createProjectSchema), async (c) => {
  if (c.get("tokenAuth").projects !== null) {
    return c.json({ error: "A project-restricted token cannot create projects" }, 403);
  }
  const service = new ProjectsService(c.env, c.executionCtx);
  try {
    const project = await service.create(c.req.valid("json"));
    return c.json(project, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Project already exists") ? 409 : 500;
    return c.json({ error: message }, status);
  }
});

projectsRoutes.patch("/:slug", zValidator("json", updateProjectSchema), async (c) => {
  const service = new ProjectsService(c.env);
  const { title, summary, tags, includeInGlobalSearch } = c.req.valid("json");
  try {
    const project = await service.update(c.req.param("slug"), {
      title: title.trim(),
      summary: summary.trim() || null,
      tags,
      includeInGlobalSearch,
    });
    return c.json(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Unknown project") ? 404 : 500;
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
    const service = new ProjectsService(c.env, c.executionCtx);
    const { entry } = c.req.valid("json");
    await service.appendMemory(c.req.param("slug"), entry);
    return c.json({ ok: true }, 201);
  }
);
