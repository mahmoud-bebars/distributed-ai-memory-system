import { z } from "zod";
import { slugSchema } from "../projects/schema";

// The action catalogue — the ONLY things the assistant (or any MCP/REST
// client) can ask to have done. Everything is a typed intent: a model never
// gets a write function, it can only emit one of these, which code validates
// (validate.ts) and a human approves before anything executes (execute.ts).
// Nothing here rewrites history: moves and tags append, archive is a flag.

export const MAX_ACTIONS_PER_PLAN = 10;
export const MAX_ENTRIES_PER_ACTION = 50;

const entryIdsSchema = z.array(z.string().min(1).max(200)).min(1).max(MAX_ENTRIES_PER_ACTION);
const tagSchema = z.string().trim().min(1).max(50);

export const createProjectAction = z.object({
  type: z.literal("create_project"),
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(2000).optional(),
  tags: z.array(tagSchema).max(20).default([]),
  includeInGlobalSearch: z.boolean().default(false),
});

export const updateProjectAction = z.object({
  type: z.literal("update_project"),
  slug: slugSchema,
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().max(2000).optional(),
  tags: z.array(tagSchema).max(20).optional(),
  includeInGlobalSearch: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const archiveProjectAction = z.object({
  type: z.literal("archive_project"),
  slug: slugSchema,
});

// Entries carry no tags field, so tagging appends an annotation observation
// that references them — the log stays append-only.
export const tagEntriesAction = z.object({
  type: z.literal("tag_entries"),
  slug: slugSchema,
  entryIds: entryIdsSchema,
  tags: z.array(tagSchema).min(1).max(10),
});

// Append-only move: copies into the target with provenance and leaves a
// `moved_to` marker in the source. Neither log is ever rewritten.
export const moveEntriesAction = z.object({
  type: z.literal("move_entries"),
  sourceSlug: slugSchema,
  targetSlug: slugSchema,
  entryIds: entryIdsSchema,
});

export const synthesisSourceSchema = z.object({ slug: slugSchema, entryId: z.string().min(1).max(200) });

// A derived entry that REFERENCES its sources — never copies or merges them.
export const writeSynthesisAction = z.object({
  type: z.literal("write_synthesis"),
  slug: slugSchema, // the target project the synthesis is written into
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(20_000),
  sources: z.array(synthesisSourceSchema).min(1).max(30),
});

export const actionSchema = z.discriminatedUnion("type", [
  createProjectAction,
  updateProjectAction,
  archiveProjectAction,
  tagEntriesAction,
  moveEntriesAction,
  writeSynthesisAction,
]);

export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action["type"];

// (An update_project that changes nothing is rejected here rather than inside
// the discriminated union, which needs plain object members.)
const actionsSchema = z
  .array(actionSchema)
  .min(1)
  .max(MAX_ACTIONS_PER_PLAN)
  .superRefine((actions, ctx) => {
    actions.forEach((a, i) => {
      if (
        a.type === "update_project" &&
        a.title === undefined &&
        a.summary === undefined &&
        a.tags === undefined &&
        a.includeInGlobalSearch === undefined &&
        a.archived === undefined
      ) {
        ctx.addIssue({ code: "custom", path: [i], message: "update_project must change at least one field" });
      }
    });
  });

export const planInputSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  // Why this plan is proposed; entry ids it relies on go in `citations`.
  rationale: z.string().trim().min(1).max(3000),
  citations: z.array(synthesisSourceSchema).max(50).default([]),
  actions: actionsSchema,
});

export type PlanInput = z.infer<typeof planInputSchema>;

// Approval body. `confirmations` maps a create_project action id to the slug
// the human typed to confirm it — the API refuses to approve a plan that
// contains a create_project unless each one is confirmed individually.
export const approvePlanSchema = z.object({
  confirmations: z.record(z.string(), z.string()).default({}),
});

export type PlanSource = "api" | "mcp" | "agent";
export type PlanStatus = "pending" | "running" | "done" | "failed" | "rejected";
export type ActionStatus = "pending" | "done" | "failed";

export interface StoredAction {
  id: string;
  seq: number;
  type: ActionType;
  payload: Action;
  status: ActionStatus;
  result: unknown;
  inverse: unknown;
  error: string | null;
}

export interface StoredPlan {
  id: string;
  status: PlanStatus;
  summary: string;
  rationale: string;
  citations: { slug: string; entryId: string }[];
  source: PlanSource;
  proposedBy: string;
  approvedBy: string | null;
  error: string | null;
  createdAt: string;
  approvedAt: string | null;
  finishedAt: string | null;
  actions: StoredAction[];
}
