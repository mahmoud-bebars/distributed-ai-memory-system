import { desc, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { projects, type ProjectRow } from "../../db/schema";
import type { Bindings } from "../../lib/bindings";
import type { CreateProjectInput, MemoryEntry } from "./schema";

const r2KeyFor = (slug: string) => `${slug}/memory.jsonl`;

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
}
