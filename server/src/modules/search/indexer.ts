import type { Bindings } from "../../lib/bindings";
import type { MemoryEntry } from "../projects/schema";
import { CloudflareSearchIndex } from "./cloudflare-index";

/** Best-effort indexing of freshly appended entries. Deliberately tiny and
 *  free of ProjectsService imports, so ProjectsService can call it without a
 *  module cycle. It never throws: a memory write must never fail or slow
 *  down because indexing failed — anything that goes wrong here just leaves
 *  the entry unindexed for the cron sweep / a reindex to pick up. */
export async function indexEntries(env: Bindings, projectSlug: string, entries: MemoryEntry[]): Promise<void> {
  try {
    await new CloudflareSearchIndex(env).upsert(entries.map((entry) => ({ projectSlug, entry })));
  } catch {
    // Swallowed on purpose — see above.
  }
}
