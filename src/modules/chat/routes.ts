import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import { chatRequestSchema } from "./schema";
import { ChatService } from "./service";

export const chatRoutes = new Hono<{ Bindings: Bindings }>();

chatRoutes.post("/:slug/chat", zValidator("json", chatRequestSchema), async (c) => {
  const service = new ChatService(c.env);
  const { question } = c.req.valid("json");

  try {
    const result = await service.ask(c.req.param("slug"), question);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Unknown project") ? 404 : 502;
    return c.json({ error: message }, status);
  }
});
