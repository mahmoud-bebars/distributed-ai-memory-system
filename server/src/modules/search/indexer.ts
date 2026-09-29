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

/** A project is indexed for search only while it is opted in to global search
 *  and not archived. Everything that touches the index (append-time indexing,
 *  backfill, sweep, reconcile) agrees on this one rule. */
export function isIndexable(project: { includeInGlobalSearch: boolean; archived: boolean }): boolean {
  return project.includeInGlobalSearch && !project.archived;
}

const REINDEX_BATCH = 25;

/** Inline (no-Workflow) full index of one project — the fallback when the
 *  SEARCH_WORKFLOW binding is missing. Small batches, never throws. */
export async function reindexProjectInline(
  env: Bindings,
  slug: string,
  readMemory: () => Promise<MemoryEntry[]>,
): Promise<void> {
  try {
    const index = new CloudflareSearchIndex(env);
    const entries = await readMemory();
    for (let i = 0; i < entries.length; i += REINDEX_BATCH) {
      await index.upsert(entries.slice(i, i + REINDEX_BATCH).map((entry) => ({ projectSlug: slug, entry })));
    }
    await env.DAMS_DB.prepare("UPDATE projects SET search_indexed_at = datetime('now') WHERE slug = ?").bind(slug).run();
  } catch {
    // Swallowed on purpose — the nightly reconcile retries.
  }
}

/** Removes every index row/vector of a project (it was turned off for global
 *  search or archived): keeps it invisible AND frees Vectorize quota. Never
 *  throws. */
export async function removeProjectFromIndex(env: Bindings, slug: string): Promise<void> {
  try {
    const { results } = await env.DAMS_DB.prepare("SELECT key FROM entry_index_status WHERE project_slug = ?")
      .bind(slug)
      .all<{ key: string }>();
    const index = new CloudflareSearchIndex(env);
    const keys = results.map((r) => r.key);
    for (let i = 0; i < keys.length; i += 100) await index.delete(keys.slice(i, i + 100));
    await env.DAMS_DB.prepare("UPDATE projects SET search_indexed_at = NULL WHERE slug = ?").bind(slug).run();
  } catch {
    // Swallowed on purpose — the next reindex/reconcile purges leftovers.
  }
}
