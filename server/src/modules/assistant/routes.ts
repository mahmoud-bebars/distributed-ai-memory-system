import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../../lib/bindings";
import { PlanStateError } from "../actions";
import type { TokenAuth } from "../tokens";
import { chatRequestSchema } from "./schema";
import { AssistantService } from "./service";
import { TasksService } from "./tasks";

type Env = { Bindings: Bindings; Variables: { tokenAuth: TokenAuth } };

export const assistantRoutes = new Hono<Env>();

// The assistant reads across projects and proposes plans over them, so it's
// only for unrestricted tokens — a project-restricted token has no "global".
assistantRoutes.use("*", async (c, next) => {
  if (c.get("tokenAuth").projects !== null) return c.json({ error: "The assistant needs an unrestricted token" }, 403);
  return next();
});

// POST /api/assistant/chat — SSE stream of AssistantEvents.
assistantRoutes.post("/chat", zValidator("json", chatRequestSchema), async (c) => {
  const service = new AssistantService(c.env, c.executionCtx);
  const auth = c.get("tokenAuth");
  const body = c.req.valid("json");
  // As in chat/routes.ts: no onError argument (Hono would append a second,
  // bare error frame) — failures are caught inside and sent as one JSON frame.
  return streamSSE(c, async (stream) => {
    try {
      for await (const event of service.chat(auth, body)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Unknown error" }),
      });
    }
  });
});

assistantRoutes.get("/conversations", async (c) => c.json(await new AssistantService(c.env).listConversations()));

assistantRoutes.get("/conversations/:id", async (c) => {
  const messages = await new AssistantService(c.env).getMessages(c.req.param("id"));
  return messages ? c.json(messages) : c.json({ error: "Unknown conversation" }, 404);
});

assistantRoutes.get("/tasks", async (c) => c.json(await new TasksService(c.env).list()));

assistantRoutes.get("/tasks/:id", async (c) => {
  const task = await new TasksService(c.env).get(c.req.param("id"));
  return task ? c.json(task) : c.json({ error: "Unknown task" }, 404);
});

const stateError = (c: Context<Env>, err: unknown) => {
  if (err instanceof PlanStateError) {
    return c.json({ error: err.message }, err.message.startsWith("Unknown") ? 404 : 409);
  }
  return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
};

// cancel / resume are admin-only (gated in index.ts): they reject or execute plans.
assistantRoutes.post("/tasks/:id/cancel", async (c) => {
  try {
    return c.json(await new TasksService(c.env).cancel(c.get("tokenAuth"), c.req.param("id")));
  } catch (err) {
    return stateError(c, err);
  }
});

assistantRoutes.post("/tasks/:id/resume", async (c) => {
  try {
    return c.json(await new TasksService(c.env).resume(c.get("tokenAuth"), c.req.param("id"), c.executionCtx), 202);
  } catch (err) {
    return stateError(c, err);
  }
});
