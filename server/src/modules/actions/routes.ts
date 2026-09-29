import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../../lib/bindings";
import type { TokenAuth } from "../tokens";
import { approvePlanSchema, planInputSchema } from "./schema";
import {
  ActionsService,
  PlanConfirmationError,
  PlanNotFoundError,
  PlanStateError,
  PlanValidationError,
} from "./service";

type Env = { Bindings: Bindings; Variables: { tokenAuth: TokenAuth } };

export const actionsRoutes = new Hono<Env>();

// Plans can reference any project, so only an unrestricted token may browse
// them — a project-restricted token gets an empty list / 404, same as it
// would for a project it can't see.
const restricted = (c: Context<Env>) => c.get("tokenAuth").projects !== null;

function errorResponse(c: Context<Env>, err: unknown) {
  if (err instanceof PlanValidationError) return c.json({ error: err.message, problems: err.problems }, 422);
  if (err instanceof PlanNotFoundError) return c.json({ error: err.message }, 404);
  if (err instanceof PlanStateError) return c.json({ error: err.message }, 409);
  if (err instanceof PlanConfirmationError) return c.json({ error: err.message }, 400);
  return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
}

// POST /api/plans — propose. Validates and stores as `pending`; NEVER
// executes. Needs read_write (method-based default).
actionsRoutes.post("/", zValidator("json", planInputSchema), async (c) => {
  try {
    const plan = await new ActionsService(c.env, c.executionCtx).propose(c.get("tokenAuth"), c.req.valid("json"), "api");
    return c.json(plan, 201);
  } catch (err) {
    return errorResponse(c, err);
  }
});

actionsRoutes.get("/", zValidator("query", z.object({ status: z.enum(["pending", "running", "done", "failed", "rejected"]).optional() })), async (c) => {
  if (restricted(c)) return c.json([]);
  return c.json(await new ActionsService(c.env).list(c.req.valid("query").status));
});

actionsRoutes.get("/:id", async (c) => {
  if (restricted(c)) return c.json({ error: "Unknown plan" }, 404);
  const plan = await new ActionsService(c.env).get(c.req.param("id"));
  return plan ? c.json(plan) : c.json({ error: `Unknown plan: ${c.req.param("id")}` }, 404);
});

// approve / reject are admin-only (gated in index.ts). Deliberately NOT
// read_write: an MCP client holding a read_write token can propose a plan,
// and must not be able to approve its own proposal over REST.
actionsRoutes.post("/:id/approve", zValidator("json", approvePlanSchema), async (c) => {
  try {
    const plan = await new ActionsService(c.env, c.executionCtx).approve(
      c.get("tokenAuth"),
      c.req.param("id"),
      c.req.valid("json").confirmations,
    );
    return c.json(plan, 202);
  } catch (err) {
    return errorResponse(c, err);
  }
});

// Retry a failed plan (only its unfinished actions run again) or resume one
// stuck `running` after a restart. Admin-only, like approve.
actionsRoutes.post("/:id/resume", async (c) => {
  try {
    return c.json(await new ActionsService(c.env, c.executionCtx).resume(c.get("tokenAuth"), c.req.param("id")), 202);
  } catch (err) {
    return errorResponse(c, err);
  }
});

actionsRoutes.post("/:id/reject", async (c) => {
  try {
    return c.json(await new ActionsService(c.env).reject(c.get("tokenAuth"), c.req.param("id")));
  } catch (err) {
    return errorResponse(c, err);
  }
});
