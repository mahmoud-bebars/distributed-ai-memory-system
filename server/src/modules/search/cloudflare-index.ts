import { z } from "zod";
import type { Bindings } from "../../lib/bindings";
import { Budget } from "../../lib/budget";
import type { IndexableEntry, SearchHit, SearchIndex, SearchQuery, UpsertOutcome } from "./index-interface";
import { reciprocalRankFusion } from "./rrf";
import { entryText, estimateTokens, indexKey } from "./text";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
// Vectorize returns at most 20 matches when metadata is requested.
const VECTOR_CANDIDATES = 20;
const KEYWORD_CANDIDATES = 30;
// D1 caps bound parameters per statement at 100.
const MAX_SLUGS_PER_QUERY = 90;
const SNIPPET_CHARS = 240;

const embeddingResponse = z.object({ data: z.array(z.array(z.number())) });

interface FtsRow {
  key: string;
  entry_id: string;
  project_slug: string;
  snippet: string;
  created_at: string | null;
}

/** Vectorize (semantic) + D1 FTS5 (keyword), fused with reciprocal rank
 *  fusion. Every vector-side capability is optional: with no `AI` or
 *  `VECTORIZE` binding, no budget left, or a failing embedding call, it
 *  silently becomes keyword-only — and none of it can throw into a caller's
 *  write path (callers wrap upsert in try/catch regardless). */
export class CloudflareSearchIndex implements SearchIndex {
  private readonly budget: Budget;

  constructor(private readonly env: Bindings) {
    this.budget = new Budget(env);
  }

  get vectorsConfigured(): boolean {
    return Boolean(this.env.AI && this.env.VECTORIZE);
  }

  async upsert(items: IndexableEntry[]): Promise<UpsertOutcome[]> {
    const prepared = await Promise.all(
      items.map(async ({ projectSlug, entry }) => ({
        projectSlug,
        entry,
        key: await indexKey(projectSlug, entry),
        text: entryText(entry),
      })),
    );
    if (prepared.length === 0) return [];

    const db = this.env.DAMS_DB;

    // Keyword half + a 'pending' status row per entry, in one batch.
    await db.batch(
      prepared.flatMap(({ key, projectSlug, entry, text }) => [
        db.prepare("DELETE FROM entry_fts WHERE key = ?").bind(key),
        db
          .prepare("INSERT INTO entry_fts (key, entry_id, project_slug, content, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(key, entry.id, projectSlug, text, entry.created_at ?? null),
        db
          .prepare(
            "INSERT INTO entry_index_status (key, project_slug, entry_id, status, vectorized, attempts) VALUES (?, ?, ?, 'pending', 0, 1) " +
              "ON CONFLICT (key) DO UPDATE SET entry_id = excluded.entry_id, status = 'pending', vectorized = 0, attempts = attempts + 1, updated_at = datetime('now')",
          )
          .bind(key, projectSlug, entry.id),
      ]),
    );

    const outcomes = new Map<string, UpsertOutcome>();
    const embeddable = prepared.filter((p) => p.text.length > 0);

    if (!this.vectorsConfigured) {
      // Keyword-only deployment: fully indexed as far as this deployment can go.
      for (const p of prepared) outcomes.set(p.key, { key: p.key, vectorized: false, status: "indexed" });
    } else if (!(await this.budget.hasRoom("ai_tokens"))) {
      // Free-tier embedding budget spent: leave pending, the cron sweep resumes tomorrow.
      for (const p of prepared) outcomes.set(p.key, { key: p.key, vectorized: false, status: "pending" });
    } else {
      try {
        if (embeddable.length > 0) {
          const vectors = await this.embed(embeddable.map((p) => p.text));
          await this.env.VECTORIZE!.upsert(
            embeddable.map((p, i) => ({
              id: p.key,
              values: vectors[i]!,
              metadata: {
                projectSlug: p.projectSlug,
                entryId: p.entry.id,
                createdAt: p.entry.created_at ?? "",
                type: p.entry.type,
              },
            })),
          );
          await this.budget.record("ai_tokens", embeddable.reduce((n, p) => n + estimateTokens(p.text), 0));
        }
        for (const p of prepared) {
          outcomes.set(p.key, { key: p.key, vectorized: true, status: "indexed" });
        }
      } catch {
        for (const p of prepared) outcomes.set(p.key, { key: p.key, vectorized: false, status: "failed" });
      }
    }

    await db.batch(
      Array.from(outcomes.values()).map((o) =>
        db
          .prepare("UPDATE entry_index_status SET status = ?, vectorized = ?, updated_at = datetime('now') WHERE key = ?")
          .bind(o.status, o.vectorized ? 1 : 0, o.key),
      ),
    );

    return prepared.map((p) => outcomes.get(p.key)!);
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const db = this.env.DAMS_DB;
    await db.batch(
      keys.flatMap((key) => [
        db.prepare("DELETE FROM entry_fts WHERE key = ?").bind(key),
        db.prepare("DELETE FROM entry_index_status WHERE key = ?").bind(key),
      ]),
    );
    if (this.env.VECTORIZE) await this.env.VECTORIZE.deleteByIds(keys);
  }

  async query({ text, projectSlugs, topK }: SearchQuery): Promise<SearchHit[]> {
    const slugs = projectSlugs.slice(0, MAX_SLUGS_PER_QUERY);
    if (slugs.length === 0 || text.trim().length === 0) return [];

    const [keywordRows, vectorRows] = await Promise.all([
      this.keywordSearch(text, slugs),
      this.vectorSearch(text, slugs),
    ]);

    const fused = reciprocalRankFusion([keywordRows.map((r) => r.key), vectorRows.map((r) => r.key)]).slice(0, topK);
    if (fused.length === 0) return [];

    // Vector-only matches carry no snippet — hydrate everything from the FTS
    // table so the response shape is identical whichever side found a hit.
    const byKey = new Map<string, FtsRow>(keywordRows.map((r) => [r.key, r]));
    const missing = fused.filter((f) => !byKey.has(f.key)).map((f) => f.key);
    if (missing.length > 0) {
      const placeholders = missing.map(() => "?").join(",");
      const { results } = await this.env.DAMS_DB.prepare(
        `SELECT key, entry_id, project_slug, substr(content, 1, ${SNIPPET_CHARS}) AS snippet, created_at FROM entry_fts WHERE key IN (${placeholders})`,
      )
        .bind(...missing)
        .all<FtsRow>();
      for (const row of results) byKey.set(row.key, row);
    }

    const allowed = new Set(slugs);
    const hits: SearchHit[] = [];
    for (const { key, score } of fused) {
      const row = byKey.get(key);
      // Defense in depth: never return a row outside the caller's project set,
      // whatever the vector filter did.
      if (!row || !allowed.has(row.project_slug)) continue;
      hits.push({
        entryId: row.entry_id,
        projectSlug: row.project_slug,
        score,
        snippet: row.snippet,
        createdAt: row.created_at,
      });
    }
    return hits;
  }

  private async keywordSearch(text: string, slugs: string[]): Promise<FtsRow[]> {
    const terms = (text.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    const placeholders = slugs.map(() => "?").join(",");
    try {
      const { results } = await this.env.DAMS_DB.prepare(
        `SELECT key, entry_id, project_slug, snippet(entry_fts, 3, '', '', '…', 32) AS snippet, created_at ` +
          `FROM entry_fts WHERE entry_fts MATCH ? AND project_slug IN (${placeholders}) ORDER BY rank LIMIT ${KEYWORD_CANDIDATES}`,
      )
        .bind(match, ...slugs)
        .all<FtsRow>();
      return results;
    } catch {
      return [];
    }
  }

  private async vectorSearch(text: string, slugs: string[]): Promise<{ key: string }[]> {
    if (!this.vectorsConfigured || !(await this.budget.hasRoom("ai_tokens"))) return [];
    try {
      const [vector] = await this.embed([text.slice(0, 500)]);
      if (!vector) return [];
      await this.budget.record("ai_tokens", estimateTokens(text));
      const matches = await this.env.VECTORIZE!.query(vector, {
        topK: VECTOR_CANDIDATES,
        returnMetadata: "all",
        filter: { projectSlug: { $in: slugs } },
      });
      return matches.matches.map((m) => ({ key: m.id }));
    } catch {
      return [];
    }
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const raw: unknown = await this.env.AI!.run(EMBEDDING_MODEL, { text: texts });
    const parsed = embeddingResponse.parse(raw);
    if (parsed.data.length !== texts.length) throw new Error("Embedding count mismatch");
    return parsed.data;
  }
}
