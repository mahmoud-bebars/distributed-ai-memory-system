import { z } from "zod";

export const chatRequestSchema = z.object({
  question: z.string().min(1).max(4000),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

export interface ChatResponse {
  answer: string;
}
