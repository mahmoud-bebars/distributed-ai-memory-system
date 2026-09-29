import type { MemoryEntry } from "../projects/schema";

// Storage-agnostic search contract. The Cloudflare implementation
// (cloudflare-index.ts) is Vectorize + D1 FTS5 merged by reciprocal rank
// fusion; a pgvector + Postgres full-text adapter could implement the same
// interface later without touching callers. Not built — just kept possible.

export interface IndexableEntry {
  projectSlug: string;
  entry: MemoryEntry;
}

export interface SearchQuery {
  text: string;
  /** Already privacy- and allow-list-filtered by the caller. */
  projectSlugs: string[];
  topK: number;
}

export interface SearchHit {
  entryId: string;
  projectSlug: string;
  score: number;
  snippet: string;
  createdAt: string | null;
}

export interface UpsertOutcome {
  key: string;
  /** false = keyword index only (no vector yet: binding missing, budget
   *  spent, or the embedding call failed). */
  vectorized: boolean;
  status: "indexed" | "pending" | "failed";
}

export interface SearchIndex {
  upsert(items: IndexableEntry[]): Promise<UpsertOutcome[]>;
  delete(keys: string[]): Promise<void>;
  query(query: SearchQuery): Promise<SearchHit[]>;
}
