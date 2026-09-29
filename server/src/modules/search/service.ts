import type { Bindings } from "../../lib/bindings";
import { Budget } from "../../lib/budget";
import { canAccessProject, type TokenAuth } from "../tokens";
import { currentEntities, ProjectsService } from "../projects/service";
import { CloudflareSearchIndex } from "./cloudflare-index";
import { isIndexable, reindexProjectInline, removeProjectFromIndex } from "./indexer";
import type { SearchHit } from "./index-interface";
import { DEFAULT_TOP_K, type CitedHit, type SearchScope } from "./schema";
import { entryText, indexKey } from "./text";

// One backfill step handles this many entries — keeps each Workflow step far
// under the Free plan's 10 ms CPU limit (the awaits on D1/Workers AI/Vectorize
// don't count against it, the JSON parsing and hashing do).
export const BACKFILL_BATCH = 25;
const SWEEP_PROJECTS = 5;
const SWEEP_ENTRIES = 50;
// A project named explicitly but not indexed (not opted in) is searched by a
// direct scan of its log instead — cap how many such scans one query does.
const MAX_SCANNED_PROJECTS = 5;
const SCAN_SNIPPET_CHARS = 240;

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

    const raw = await this.queryScoped(scope.slugs, input.query, input.topK ?? DEFAULT_TOP_K);
    return { hits: await this.withProjectTitles(raw), unknown: scope.unknown };
  }

  /** Runs a query over an authorised slug set. Opted-in projects go through
   *  the hybrid index; a project that was named explicitly but isn't indexed
   *  (not opted in) is scanned directly from its log with a simple keyword
   *  score — the index only holds opted-in projects, but naming one is still
   *  a supported way to search it. */
  private async queryScoped(slugs: string[], text: string, topK: number): Promise<SearchHit[]> {
    const indexable = new Set((await this.projects.list()).filter(isIndexable).map((p) => p.slug));
    const indexed = slugs.filter((s) => indexable.has(s));
    const scanned = slugs.filter((s) => !indexable.has(s)).slice(0, MAX_SCANNED_PROJECTS);

    const [fromIndex, ...fromScans] = await Promise.all([
      indexed.length > 0 ? this.index.query({ text, projectSlugs: indexed, topK }) : Promise.resolve<SearchHit[]>([]),
      ...scanned.map((slug) => this.scanProject(slug, text, topK)),
    ]);
    return [fromIndex, ...fromScans].flat().sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private async scanProject(slug: string, text: string, topK: number): Promise<SearchHit[]> {
    const terms = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
    if (terms.length === 0) return [];
    const entries = await this.projects.readMemory(slug);
    // Entities are last-write-wins: search the current view of them.
    const pool = [...currentEntities(entries), ...entries.filter((e) => e.type !== "entity")];
    return pool
      .map((entry) => {
        const body = entryText(entry);
        const haystack = body.toLowerCase();
        return { entry, body, matches: terms.reduce((n, t) => n + (haystack.split(t).length - 1), 0) };
      })
      .filter((r) => r.matches > 0)
      .sort((a, b) => b.matches - a.matches)
      .slice(0, topK)
      // Rank-based scores on the same scale as reciprocal rank fusion, so scan
      // and index hits can be merged.
      .map((r, rank) => ({
        entryId: r.entry.id,
        projectSlug: slug,
        score: 1 / (60 + rank + 1),
        snippet: r.body.slice(0, SCAN_SNIPPET_CHARS),
        createdAt: r.entry.created_at ?? null,
      }));
  }

  /** Search over an explicit, already-authorised slug set — the assistant
   *  computes which projects a turn may read (opted in, or named by the
   *  user) and passes exactly that. */
  async searchSlugs(slugs: string[], query: string, topK = DEFAULT_TOP_K): Promise<CitedHit[]> {
    if (slugs.length === 0) return [];
    return this.withProjectTitles(await this.queryScoped(slugs, query, topK));
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

  async status(): Promise<{
    vectors: boolean;
    eligibleProjects: number;
    total: number;
    indexed: number;
    pending: number;
    failed: number;
    keywordOnly: number;
  }> {
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
    const eligibleProjects = (await this.projects.list()).filter(isIndexable).length;
    return { vectors: this.vectorsConfigured, eligibleProjects, total, indexed, pending, failed, keywordOnly };
  }

  /** Slugs that should be in the index right now: opted in and not archived
   *  (optionally narrowed to `only`). */
  async eligibleSlugs(only?: string[]): Promise<string[]> {
    return (await this.projects.list())
      .filter(isIndexable)
      .map((p) => p.slug)
      .filter((slug) => only === undefined || only.includes(slug))
      .sort();
  }

  /** Indexes one batch of a project's entries. Idempotent — the index key is
   *  stable, so re-running just overwrites — which is what makes both the
   *  Workflow's step retries and a full re-run safe. `next` is the offset to
   *  continue from, or null when this project is done. */
  async reindexBatch(slug: string, offset: number, size = BACKFILL_BATCH): Promise<{ total: number; next: number | null }> {
    const entries = await this.projects.readMemory(slug);
    const slice = entries.slice(offset, offset + size);
    if (slice.length > 0) await this.index.upsert(slice.map((entry) => ({ projectSlug: slug, entry })));
    const next = offset + size < entries.length ? offset + size : null;
    if (next === null) {
      await this.env.DAMS_DB.prepare("UPDATE projects SET search_indexed_at = datetime('now') WHERE slug = ?").bind(slug).run();
    }
    return { total: entries.length, next };
  }

  /** Drops index rows/vectors of projects that are no longer eligible (turned
   *  off for global search, archived, or indexed before that rule existed). */
  async purgeIneligible(): Promise<void> {
    const eligible = new Set(await this.eligibleSlugs());
    const { results } = await this.env.DAMS_DB.prepare("SELECT DISTINCT project_slug FROM entry_index_status").all<{
      project_slug: string;
    }>();
    for (const { project_slug: slug } of results) {
      if (!eligible.has(slug)) await removeProjectFromIndex(this.env, slug);
    }
  }

  /** Re-indexes opted-in projects: all of them, or just `slug`. Uses the
   *  backfill Workflow when bound, otherwise a best-effort inline loop via
   *  waitUntil (small batches; just not durable across restarts). Throws if
   *  `slug` isn't eligible (not opted in / archived). */
  async startReindex(slug?: string): Promise<{ started: "workflow" | "inline"; projects: number }> {
    if (slug === undefined) await this.purgeIneligible();
    const slugs = await this.eligibleSlugs(slug === undefined ? undefined : [slug]);
    if (slug !== undefined && slugs.length === 0) {
      throw new Error(`Project isn't included in global search: ${slug}`);
    }
    if (slugs.length === 0) return { started: this.env.SEARCH_WORKFLOW ? "workflow" : "inline", projects: 0 };
    return { started: await this.dispatchReindex(slugs), projects: slugs.length };
  }

  private async dispatchReindex(slugs: string[]): Promise<"workflow" | "inline"> {
    if (this.env.SEARCH_WORKFLOW) {
      await this.env.SEARCH_WORKFLOW.create({ params: { slugs } });
      return "workflow";
    }
    const run = async () => {
      for (const slug of slugs) await reindexProjectInline(this.env, slug, () => this.projects.readMemory(slug));
    };
    const task = run().catch(() => {});
    if (this.ctx) this.ctx.waitUntil(task);
    else await task;
    return "inline";
  }

  /** Nightly reconcile (cron): purge what shouldn't be indexed, then re-index
   *  any opted-in project that was never fully indexed or changed since. This
   *  is the "reindex runs on its own" path — a fresh deploy or a project
   *  flipped on while a Workflow was unavailable converges without anyone
   *  clicking anything. Idle projects cost nothing. */
  async reconcile(): Promise<number> {
    await this.purgeIneligible();
    const drifted = (await this.projects.list())
      .filter(isIndexable)
      .filter((p) => p.searchIndexedAt === null || p.searchIndexedAt < p.updatedAt)
      .map((p) => p.slug);
    if (drifted.length > 0) await this.dispatchReindex(drifted);
    return drifted.length;
  }

  /** Cron sweep: retries entries left pending/failed (embedding failed or the
   *  daily Workers AI budget was spent) and — once vectors are configured —
   *  upgrades keyword-only rows. Bounded per run so it stays inside the Free
   *  plan's limits; the next tick continues where this one stopped. */
  async sweep(): Promise<void> {
    const vectorsOn = this.vectorsConfigured;
    if (vectorsOn && !(await new Budget(this.env).hasRoom("ai_tokens"))) return;

    const eligible = (await this.eligibleSlugs()).slice(0, 90);
    if (eligible.length === 0) return;
    const inEligible = `project_slug IN (${eligible.map(() => "?").join(",")})`;

    const needsWork = vectorsOn ? "(status != 'indexed' OR vectorized = 0)" : "status = 'failed'";
    const db = this.env.DAMS_DB;
    const { results: slugs } = await db
      .prepare(`SELECT DISTINCT project_slug FROM entry_index_status WHERE ${needsWork} AND ${inEligible} LIMIT ${SWEEP_PROJECTS}`)
      .bind(...eligible)
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
