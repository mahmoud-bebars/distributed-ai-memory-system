import { desc, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { projects, type ProjectRow } from "../../db/schema";
import type { Bindings } from "../../lib/bindings";
import type { CreateProjectInput, MemoryEntry } from "./schema";

const r2KeyFor = (slug: string) => `${slug}/memory.jsonl`;

const entityName = (entry: MemoryEntry): string => String(entry.content.name ?? entry.id);

/** Last-write-wins projection of entities: dedupe by `content.name`,
 *  keeping the last occurrence in file order as current. Storage stays
 *  append-only — this reads the log, it never rewrites it. Relations and
 *  observations aren't deduped here; every one is part of the log. */
export function currentEntities(entries: MemoryEntry[]): MemoryEntry[] {
  const byName = new Map<string, MemoryEntry>();
  for (const entry of entries) {
    if (entry.type !== "entity") continue;
    byName.set(entityName(entry), entry);
  }
  return Array.from(byName.values());
}

export class ProjectsService {
  private readonly db: DrizzleD1Database;

  constructor(private readonly env: Bindings) {
    this.db = drizzle(env.DAMS_DB);
  }

  async list(): Promise<ProjectRow[]> {
    return this.db.select().from(projects).orderBy(desc(projects.updatedAt));
  }

  async get(slug: string): Promise<ProjectRow | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    return rows[0] ?? null;
  }

  async create(input: CreateProjectInput): Promise<ProjectRow> {
    // Guard before touching R2 so a duplicate slug can't (a) blow up with an
    // opaque 500 on the D1 primary-key violation, nor (b) orphan a seeded R2
    // object for a row that never gets inserted. The route maps this message
    // to a 409, mirroring how the chat route maps "Unknown project" to a 404.
    if (await this.get(input.slug)) {
      throw new Error(`Project already exists: ${input.slug}`);
    }

    const r2Key = r2KeyFor(input.slug);

    // Seed an empty object so reads never 404 before the first append.
    await this.env.DAMS_BUCKET.put(r2Key, "");

    await this.db.insert(projects).values({
      slug: input.slug,
      title: input.title,
      summary: input.summary ?? null,
      tags: JSON.stringify(input.tags),
      r2Key,
    });

    return (await this.get(input.slug))!;
  }

  /** Reads the full JSONL blob and parses it into entries. Fine at small scale;
   *  revisit with range reads or a D1 entity index once files get large. */
  async readMemory(slug: string): Promise<MemoryEntry[]> {
    const project = await this.get(slug);
    if (!project) return [];

    const object = await this.env.DAMS_BUCKET.get(project.r2Key);
    if (!object) return [];

    const text = await object.text();
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as MemoryEntry);
  }

  /** Returns the raw R2 object for streaming (byte-for-byte memory.jsonl),
   *  or null if the project or its blob doesn't exist. */
  async readMemoryRaw(slug: string): Promise<R2ObjectBody | null> {
    const project = await this.get(slug);
    if (!project) return null;

    return this.env.DAMS_BUCKET.get(project.r2Key);
  }

  /** Appends one line to the R2 blob and bumps the D1 registry row.
   *  R2 has no native append, so this does a read-modify-write —
   *  fine for single-user traffic, not for concurrent writers. */
  async appendMemory(slug: string, entry: MemoryEntry): Promise<void> {
    const project = await this.get(slug);
    if (!project) throw new Error(`Unknown project: ${slug}`);

    const existing = await this.env.DAMS_BUCKET.get(project.r2Key);
    const existingText = existing ? await existing.text() : "";
    const line = JSON.stringify(entry);
    const updatedText = existingText.length > 0 ? `${existingText}\n${line}` : line;

    await this.env.DAMS_BUCKET.put(project.r2Key, updatedText);

    await this.db
      .update(projects)
      .set({
        entityCount: sql`${projects.entityCount} + 1`,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(projects.slug, slug));
  }

  /** Appends a new revision of an existing entity, merging `updates` onto
   *  its current (last-write-wins) content. Fails if no entity with that
   *  name exists yet — creation stays `appendMemory`'s job, this only
   *  edits. */
  async updateEntity(
    slug: string,
    name: string,
    updates: Record<string, unknown>
  ): Promise<MemoryEntry> {
    const entries = await this.readMemory(slug);
    const current = currentEntities(entries).find((e) => entityName(e) === name);
    if (!current) {
      throw new Error(`Unknown entity: ${name} (in project ${slug})`);
    }

    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      type: "entity",
      content: { ...current.content, ...updates, name },
      created_at: new Date().toISOString(),
    };

    await this.appendMemory(slug, entry);
    return entry;
  }
}
