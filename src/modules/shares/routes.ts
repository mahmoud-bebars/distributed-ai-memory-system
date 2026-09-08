import { Hono } from "hono";
import type { Bindings } from "../../lib/bindings";
import { ProjectsService } from "../projects";
import { SharesService } from "./service";

// Mounted at /api/projects — authenticated the same way the rest of the REST
// API is (i.e. not gated in code; Cloudflare Access on memory.mahmoudbebars.dev
// is what actually protects these in production).
export const projectShareRoutes = new Hono<{ Bindings: Bindings }>();

projectShareRoutes.get("/:slug/share", async (c) => {
  const service = new SharesService(c.env);
  return c.json(await service.status(c.req.param("slug")));
});

projectShareRoutes.post("/:slug/share", async (c) => {
  const service = new SharesService(c.env);
  try {
    const result = await service.create(c.req.param("slug"));
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Unknown project") ? 404 : 500;
    return c.json({ error: message }, status);
  }
});

projectShareRoutes.delete("/:slug/share", async (c) => {
  const service = new SharesService(c.env);
  await service.revoke(c.req.param("slug"));
  return c.json({ ok: true });
});

// Mounted at /api/share — deliberately public, no auth wiring at all. The
// token itself is the auth: a valid one returns the project's memory, an
// invalid or missing one 404s the same way an unknown project would, so a
// guess can't tell "wrong token" apart from "no such thing".
export const publicShareRoutes = new Hono<{ Bindings: Bindings }>();

publicShareRoutes.get("/:token/memory", async (c) => {
  const shares = new SharesService(c.env);
  const project = await shares.resolveProjectByToken(c.req.param("token"));
  if (!project) return c.json({ error: "Not found" }, 404);

  const projects = new ProjectsService(c.env);
  return c.json(await projects.readMemory(project.slug));
});
