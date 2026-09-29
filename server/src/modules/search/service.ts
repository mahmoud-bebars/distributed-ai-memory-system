import type { Bindings } from "../../lib/bindings";
import { Budget } from "../../lib/budget";
import { canAccessProject, type TokenAuth } from "../tokens";
import { ProjectsService } from "../projects/service";
import { CloudflareSearchIndex } from "./cloudflare-index";
import type { SearchHit } from "./index-interface";
import { DEFAULT_TOP_K, type CitedHit, type SearchScope } from "./schema";
import { indexKey } from "./text";

// One backfill step handles this many entries — keeps each Workflow step far
// under the Free plan's 10 ms CPU limit (the awaits on D1/Workers AI/Vectorize
// don't count against it, the JSON parsing and hashing do).
export const BACKFILL_BATCH = 25;
const SWEEP_PROJECTS = 5;
const SWEEP_ENTRIES = 50;

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export class SearchService {
  private readonly index: CloudflareSearchIndex;
  private readonly projects: ProjectsService;

  constructor(
    private readonly env: Bindings,
    private readonly ctx?: WaitUntil,
  ) {
    this.index = new CloudflareSearchIndex(env);
    this.projects = new ProjectsService(env);
  }

  get vectorsConfigured(): boolean {
    return this.index.vectorsConfigured;
  }

  /** Which projects a cross-project search may touch for this caller.
   *  Default (no explicit list): projects the token can access AND that opted
   *  in via includeInGlobalSearch. Explicitly named projects skip the opt-in
   *  flag — asking for one by name is the documented override — but never the
   *  token allow-list. Names that don't exist and names outside the
   *  allow-list land in `unknown` together, indistinguishably. */
  async resolveScope(auth: TokenAuth, requested?: string[]): Promise<SearchScope> {
    const accessible = (await this.projects.list()).filter((p) => canAccessProject(auth, p.slug));
    if (requested && requested.length > 0) {
      const known = new Set(accessible.map((p) => p.slug));
      return {
        slugs: requested.filter((s) => known.has(s)),
        unknown: requested.filter((s) => !known.has(s)),
      };
    }
    return {
      slugs: accessible.filter((p) => p.includeInGlobalSearch && !p.archived).map((p) => p.slug),
      unknown: [],
    };
  }

  async search(
    auth: TokenAuth,
    input: { query: string; projectSlugs?: string[]; topK?: number },
  ): Promise<{ hits: CitedHit[]; unknown: string[] }> {
    const scope = await this.resolveScope(auth, input.projectSlugs);
    if (scope.slugs.length === 0) return { hits: [], unknown: scope.unknown };

    const raw = await this.index.query({
      text: input.query,
      projectSlugs: scope.slugs,
      topK: input.topK ?? DEFAULT_TOP_K,
    });
    return { hits: await this.withProjectTitles(raw), unknown: scope.unknown };
  }

  /** Search over an explicit, already-authorised slug set — the assistant
   *  computes which projects a turn may read (opted in, or named by the
   *  user) and passes exactly that. */
  async searchSlugs(slugs: string[], query: string, topK = DEFAULT_TOP_K): Promise<CitedHit[]> {
    if (slugs.length === 0) return [];
    return this.withProjectTitles(await this.index.query({ text: query, projectSlugs: slugs, topK }));
  }

  /** Single-project retrieval for per-project chat — the caller already
   *  proved access to `slug` (the /api/projects/:slug/* guard), and a
   *  project's own chat never depends on its global-search opt-in. */
  async searchProject(slug: string, query: string, topK: number): Promise<SearchHit[]> {
    return this.index.query({ text: query, projectSlugs: [slug], topK });
  }

  private async withProjectTitles(hits: SearchHit[]): Promise<CitedHit[]> {
    if (hits.length === 0) return [];
    const titles = new Map((await this.projects.list()).map((p) => [p.slug, p.title]));
    return hits.map((h) => ({
      entryId: h.entryId,
      project: { slug: h.projectSlug, title: titles.get(h.projectSlug) ?? h.projectSlug },
      createdAt: h.createdAt,
      snippet: h.snippet,
      score: h.score,
    }));
  }

  async status(): Promise<{ vectors: boolean; total: number; indexed: number; pending: number; failed: number; keywordOnly: number }> {
    const { results } = await this.env.DAMS_DB.prepare(
      "SELECT status, vectorized, COUNT(*) AS n FROM entry_index_status GROUP BY status, vectorized",
    ).all<{ status: string; vectorized: number; n: number }>();
    let total = 0;
    let indexed = 0;
    let pending = 0;
    let failed = 0;
    let keywordOnly = 0;
    for (const row of results) {
      total += row.n;
      if (row.status === "indexed") {
        indexed += row.n;
        if (row.vectorized === 0) keywordOnly += row.n;
      } else if (row.status === "pending") pending += row.n;
      else failed += row.n;
    }
    return { vectors: this.vectorsConfigured, total, indexed, pending, failed, keywordOnly };
  }

  async listProjectSlugs(): Promise<string[]> {
    return (await this.projects.list()).map((p) => p.slug).sort();
  }

  /** Indexes one batch of a project's entries. Idempotent — the index key is
   *  stable, so re-running just overwrites — which is what makes both the
   *  Workflow's step retries and a full re-run safe. `next` is the offset to
   *  continue from, or null when this project is done. */
  async reindexBatch(slug: string, offset: number, size = BACKFILL_BATCH): Promise<{ total: number; next: number | null }> {
    const entries = await this.projects.readMemory(slug);
    const slice = entries.slice(offset, offset + size);
    if (slice.length > 0) await this.index.upsert(slice.map((entry) => ({ projectSlug: slug, entry })));
    return { total: entries.length, next: offset + size < entries.length ? offset + size : null };
  }

  /** Kicks off a full backfill: a Workflow instance when the binding exists,
   *  otherwise a best-effort inline loop via waitUntil (each batch is still
   *  small; it just isn't durable across restarts). */
  async startReindex(): Promise<"workflow" | "inline"> {
    if (this.env.SEARCH_WORKFLOW) {
      await this.env.SEARCH_WORKFLOW.create({ params: {} });
      return "workflow";
    }
    const run = async () => {
      for (const slug of await this.listProjectSlugs()) {
        let offset: number | null = 0;
        while (offset !== null) {
          offset = (await this.reindexBatch(slug, offset)).next;
        }
      }
    };
    const task = run().catch(() => {});
    if (this.ctx) this.ctx.waitUntil(task);
    else await task;
    return "inline";
  }

  /** Cron sweep: retries entries left pending/failed (embedding failed or the
   *  daily Workers AI budget was spent) and — once vectors are configured —
   *  upgrades keyword-only rows. Bounded per run so it stays inside the Free
   *  plan's limits; the next tick continues where this one stopped. */
  async sweep(): Promise<void> {
    const vectorsOn = this.vectorsConfigured;
    if (vectorsOn && !(await new Budget(this.env).hasRoom("ai_tokens"))) return;

    const needsWork = vectorsOn ? "(status != 'indexed' OR vectorized = 0)" : "status = 'failed'";
    const db = this.env.DAMS_DB;
    const { results: slugs } = await db
      .prepare(`SELECT DISTINCT project_slug FROM entry_index_status WHERE ${needsWork} LIMIT ${SWEEP_PROJECTS}`)
      .all<{ project_slug: string }>();

    for (const { project_slug: slug } of slugs) {
      const { results: rows } = await db
        .prepare(`SELECT key FROM entry_index_status WHERE project_slug = ? AND ${needsWork} LIMIT ${SWEEP_ENTRIES}`)
        .bind(slug)
        .all<{ key: string }>();
      const wanted = new Set(rows.map((r) => r.key));

      // Later entries win, matching entity last-write-wins semantics.
      const latest = new Map<string, Awaited<ReturnType<ProjectsService["readMemory"]>>[number]>();
      for (const entry of await this.projects.readMemory(slug)) {
        const key = await indexKey(slug, entry);
        if (wanted.has(key)) latest.set(key, entry);
      }
      if (latest.size > 0) {
        await this.index.upsert(Array.from(latest.values(), (entry) => ({ projectSlug: slug, entry })));
      }
    }
  }
}
