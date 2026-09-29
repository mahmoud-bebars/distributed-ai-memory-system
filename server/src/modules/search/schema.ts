import { z } from "zod";
import { slugSchema } from "../projects/schema";

export const DEFAULT_TOP_K = 8;
export const MAX_TOP_K = 20;

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  // Comma-separated slugs on the REST route; naming a project explicitly is
  // the one way to search one that hasn't opted in to global search.
  projects: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(slugSchema).max(20).optional()),
  topK: z.coerce.number().int().min(1).max(MAX_TOP_K).optional(),
});

export type SearchScope = {
  /** Project slugs the search may cover. */
  slugs: string[];
  /** Explicitly requested slugs that don't exist or aren't accessible to the
   *  caller — reported identically either way ("Unknown project"). */
  unknown: string[];
};

export interface CitedHit {
  entryId: string;
  project: { slug: string; title: string };
  createdAt: string | null;
  snippet: string;
  score: number;
}
