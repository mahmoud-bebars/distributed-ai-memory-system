import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import { chatRequestSchema } from "./schema";
import { ChatService } from "./service";

export const chatRoutes = new Hono<{ Bindings: Bindings }>();

chatRoutes.post("/:slug/chat", zValidator("json", chatRequestSchema), async (c) => {
  const service = new ChatService(c.env);
  const { question, docFilename, history } = c.req.valid("json");
  const slug = c.req.param("slug");

  // Validate BEFORE any streaming starts — once streamSSE below has sent
  // its headers, the HTTP status can no longer change, so "unknown
  // project"/"unknown doc" still need to 404 the normal way.
  try {
    await service.assertExists(slug, docFilename);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Unknown project") || message.startsWith("Unknown doc") ? 404 : 502;
    return c.json({ error: message }, status);
  }

  // Deliberately no third (onError) argument to streamSSE: Hono's `run()`
  // always appends its OWN bare-string "event: error" frame after calling
  // that handler, on top of whatever it wrote — two error frames per
  // failure. Catching inside this callback instead means nothing ever
  // escapes to streamSSE's catch, so only our single JSON-shaped frame
  // goes out.
  return streamSSE(c, async (stream) => {
    try {
      for await (const event of service.ask(slug, question, { docFilename, history, signal: c.req.raw.signal })) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === "done" || event.type === "error") return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message }) });
    }
  });
});
