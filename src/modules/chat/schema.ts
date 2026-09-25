import { z } from "zod";
import type { DeleteDocInput, UpdateDocInput } from "../docs/schema";
import type { MemoryEntry } from "../projects/schema";

export const chatRequestSchema = z.object({
  question: z.string().min(1).max(4000),
  // When set, ChatService scopes the docs half of its context to just this
  // one file instead of dumping every doc — memory stays unscoped either
  // way. Lets a question about one specific doc skip the token cost of
  // every other doc in the project.
  docFilename: z.string().min(1).optional(),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

// A memory entry the model says it actually drew on to answer — not a
// retrieval result (the whole log is still dumped into the prompt, see
// ChatService), just a citation the model reports back so the UI can show
// which parts of memory the answer came from.
export interface ChatSource {
  id: string;
  type: MemoryEntry["type"];
  summary: string;
}

// A mutating doc edit the model called as a tool mid-conversation, returned
// to the frontend unexecuted — ChatService never runs update_doc/delete_doc
// itself. The frontend renders this as an Approve/Reject card; only an
// explicit Approve click hits the real PUT/DELETE doc routes.
export type ProposedAction =
  | { tool: "update_doc"; input: UpdateDocInput }
  | { tool: "delete_doc"; input: DeleteDocInput };

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  proposedAction?: ProposedAction;
}
