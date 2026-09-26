import { z } from "zod";
import type { DeleteDocInput, UpdateDocInput } from "../docs/schema";
import type { MemoryEntry } from "../projects/schema";

// A prior turn the client already holds (and persists to its own browser
// storage — see client/src/lib/chatStorage.ts). There's no server-side
// session store, so conversational continuity across separate questions
// works by the client replaying a capped window of its own history back to
// us on every request rather than us remembering anything between calls.
export const chatHistoryTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
});

export const chatRequestSchema = z.object({
  question: z.string().min(1).max(4000),
  // When set, ChatService scopes the docs half of its context to just this
  // one file instead of searching — memory stays search-driven either way.
  docFilename: z.string().min(1).optional(),
  // Capped client-side: see chatHistoryTurnSchema's comment.
  history: z.array(chatHistoryTurnSchema).max(10).optional(),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
export type ChatHistoryTurn = z.infer<typeof chatHistoryTurnSchema>;

// Input schemas for the read-only retrieval tools ChatService executes
// itself mid-conversation (unlike update_doc/delete_doc below, which are
// only ever proposed, never run here) — same toInputSchema(zodObject)
// conversion as the mutating tools, see chat/service.ts.
export const searchMemoryInputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).optional(),
});

export const listDocsInputSchema = z.object({});

export const searchDocsInputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(10).optional(),
});

export const readDocInputSchema = z.object({
  filename: z.string().min(1),
});

// A memory entry or doc the model actually pulled in via an executed
// retrieval tool this turn — replaces the old model-self-reported
// "SOURCES: id1, id2" line, which only ever covered memory entries and
// wasn't grounded in anything we could verify. Doc provenance is trackable
// for the first time now that search_docs/read_doc are real, executed calls.
export type ChatSource =
  | { kind: "memory"; id: string; type: MemoryEntry["type"]; summary: string }
  | { kind: "doc"; filename: string; snippet: string };

// A mutating doc edit the model called as a tool mid-conversation, returned
// to the frontend unexecuted — ChatService never runs update_doc/delete_doc
// itself. The frontend renders this as an Approve/Reject card; only an
// explicit Approve click hits the real PUT/DELETE doc routes.
export type ProposedAction =
  | { tool: "update_doc"; input: UpdateDocInput }
  | { tool: "delete_doc"; input: DeleteDocInput };

// The wire protocol for POST /chat now — an SSE stream of these, not a
// single JSON blob. `status` events are the "what is the agent doing"
// narration the UI shows while a tool round is in flight; `text` events are
// token-by-token answer deltas. Exactly one of `proposedAction` or the
// stream simply ending after `sources` terminates a turn.
export type ChatStreamEvent =
  | { type: "status"; label: string }
  | { type: "text"; delta: string }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "proposedAction"; action: ProposedAction }
  | { type: "done" }
  | { type: "error"; message: string };
