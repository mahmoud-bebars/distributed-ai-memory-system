import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import { chatRequestSchema, ChatService } from "../chat";
import { DocsService } from "../docs";
import { ProjectsService } from "../projects";
import { createShareLinkSchema, updateShareLinkSchema } from "./schema";
import { shareUrl, SharesService } from "./service";

// Mounted at /api/projects — authenticated the same way the rest of the REST
// API is (i.e. not gated in code; Cloudflare Access on memory.mahmoudbebars.dev
// is what actually protects these in production).
export const projectShareRoutes = new Hono<{ Bindings: Bindings }>();

projectShareRoutes.get("/:slug/share", async (c) => {
  const service = new SharesService(c.env);
  const links = await service.list(c.req.param("slug"));
  return c.json(links.map((link) => ({ ...link, url: shareUrl(link.token) })));
});

projectShareRoutes.post("/:slug/share", zValidator("json", createShareLinkSchema), async (c) => {
  const service = new SharesService(c.env);
  try {
    const link = await service.create(c.req.param("slug"), c.req.valid("json"));
    return c.json({ ...link, url: shareUrl(link.token) }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Unknown project") ? 404 : 500;
    return c.json({ error: message }, status);
  }
});

projectShareRoutes.patch(
  "/:slug/share/:token",
  zValidator("json", updateShareLinkSchema),
  async (c) => {
    const service = new SharesService(c.env);
    try {
      const link = await service.update(c.req.param("slug"), c.req.param("token"), c.req.valid("json"));
      return c.json({ ...link, url: shareUrl(link.token) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status = message.startsWith("Unknown share link") ? 404 : 500;
      return c.json({ error: message }, status);
    }
  },
);

projectShareRoutes.delete("/:slug/share/:token", async (c) => {
  const service = new SharesService(c.env);
  await service.revoke(c.req.param("slug"), c.req.param("token"));
  return c.json({ ok: true });
});

// Mounted at /api/share — deliberately public, no auth wiring at all. The
// token itself is the auth: a valid, unexpired one resolves to a project and
// its link settings; anything else (unknown token, expired token, token
// whose project got deleted) 404s the exact same way, so a guess can't tell
// those cases apart. Docs and chat are additionally gated by that link's own
// allowDocs/allowChat — Graph/Entries (i.e. project memory) has no such
// gate, since sharing at all means sharing at least that much.
export const publicShareRoutes = new Hono<{ Bindings: Bindings }>();

publicShareRoutes.get("/:token", async (c) => {
  const shares = new SharesService(c.env);
  const resolved = await shares.resolveByToken(c.req.param("token"));
  if (!resolved) return c.json({ error: "Not found" }, 404);

  const { project, share } = resolved;
  return c.json({
    project: { slug: project.slug, title: project.title, summary: project.summary },
    label: share.label,
    allowChat: share.allowChat,
    allowDocs: share.allowDocs,
  });
});

publicShareRoutes.get("/:token/memory", async (c) => {
  const shares = new SharesService(c.env);
  const resolved = await shares.resolveByToken(c.req.param("token"));
  if (!resolved) return c.json({ error: "Not found" }, 404);

  const projects = new ProjectsService(c.env);
  return c.json(await projects.readMemory(resolved.project.slug));
});

// Read-only doc access for share links — same token-is-the-auth model as
// /memory above, and deliberately only GET: no append/update/delete routes
// exist here, so a share link can never mutate a project's docs no matter
// what the frontend does or doesn't render. Additionally gated by
// allowDocs — a link that only shares the graph 404s here exactly like an
// invalid token would.
publicShareRoutes.get("/:token/docs", async (c) => {
  const shares = new SharesService(c.env);
  const resolved = await shares.resolveByToken(c.req.param("token"));
  if (!resolved || !resolved.share.allowDocs) return c.json({ error: "Not found" }, 404);

  const docs = new DocsService(c.env);
  return c.json({ filenames: await docs.list(resolved.project.slug) });
});

publicShareRoutes.get("/:token/docs/:filename", async (c) => {
  const shares = new SharesService(c.env);
  const resolved = await shares.resolveByToken(c.req.param("token"));
  if (!resolved || !resolved.share.allowDocs) return c.json({ error: "Not found" }, 404);

  const docs = new DocsService(c.env);
  const content = await docs.read(resolved.project.slug, c.req.param("filename"));
  if (content === null) return c.json({ error: "Not found" }, 404);

  return new Response(content, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
});

// Chat over a share link — only reachable when that specific link has
// allowChat on. Uses the owner's ANTHROPIC_API_KEY (the Worker's one and
// only key; there's no per-visitor key), and never offers the mutating
// update_doc/delete_doc tools regardless of allowDocs — a read-only
// recipient has no approve/reject UI to act on a proposed edit anyway, and
// there's no authenticated route here for an Approve click to succeed
// against even if one were shown.
publicShareRoutes.post("/:token/chat", zValidator("json", chatRequestSchema), async (c) => {
  const shares = new SharesService(c.env);
  const resolved = await shares.resolveByToken(c.req.param("token"));
  if (!resolved || !resolved.share.allowChat) return c.json({ error: "Not found" }, 404);

  const { question, docFilename } = c.req.valid("json");
  const chat = new ChatService(c.env);
  try {
    const result = await chat.ask(resolved.project.slug, question, {
      docFilename: resolved.share.allowDocs ? docFilename : undefined,
      includeDocs: resolved.share.allowDocs,
      allowMutatingTools: false,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Unknown doc") ? 404 : 502;
    return c.json({ error: message }, status);
  }
});
