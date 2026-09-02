import { z } from "zod";
import type { MemoryEntry } from "../projects/schema";

export const chatRequestSchema = z.object({
  question: z.string().min(1).max(4000),
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

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
}
