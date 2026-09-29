import { z } from "zod";
import { planInputSchema } from "../actions/schema";
import { slugSchema } from "../projects/schema";

// The ONE thing the model returns each loop iteration: exactly one typed
// move. It can read (search / read_entries, executed by code) or end the turn
// (answer / propose_plan / ask_user). It has no write move — a plan it
// proposes is validated by code and still needs a human's approval.
const entryRefSchema = z.object({ slug: slugSchema, entryId: z.string().min(1).max(200) });

export const moveSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("search"),
    query: z.string().min(1).max(300),
    projectSlugs: z.array(slugSchema).max(10).optional(),
  }),
  z.object({ type: z.literal("read_entries"), entries: z.array(entryRefSchema).min(1).max(10) }),
  z.object({
    type: z.literal("answer"),
    text: z.string().min(1).max(6000),
    citations: z.array(entryRefSchema).max(20).default([]),
  }),
  z.object({ type: z.literal("propose_plan"), plan: planInputSchema }),
  z.object({ type: z.literal("ask_user"), question: z.string().min(1).max(1000) }),
]);

export type Move = z.infer<typeof moveSchema>;

// Anthropic tool inputs must be objects, so the union is wrapped.
export const moveEnvelopeSchema = z.object({ move: moveSchema });

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
});

export type TaskStatus = "planning" | "awaiting_approval" | "running" | "done" | "failed" | "cancelled" | "expired";

export interface Citation {
  slug: string;
  entryId: string;
  project: string; // project title
  snippet: string;
}

export type AssistantEvent =
  | { type: "conversation"; id: string }
  | { type: "task"; id: string }
  | { type: "status"; label: string }
  | { type: "answer"; text: string; citations: Citation[] }
  | { type: "plan"; planId: string; summary: string }
  | { type: "ask"; question: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface StoredTask {
  id: string;
  conversationId: string;
  title: string;
  goal: string;
  status: TaskStatus;
  planId: string | null;
  currentStep: string | null;
  createdAt: string;
  updatedAt: string;
  events?: { at: string; event: string; detail: string | null }[];
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "answer" | "ask" | "plan";
  content: string;
  citations: Citation[];
  planId: string | null;
  createdAt: string;
}
