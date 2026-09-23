import type { Bindings } from "../../lib/bindings";
import { ProjectsService } from "../projects";

const r2PrefixFor = (slug: string) => `${slug}/docs/`;
const r2KeyFor = (slug: string, filename: string) => `${slug}/docs/${filename}`;

export class DocsService {
  private readonly projects: ProjectsService;

  constructor(private readonly env: Bindings) {
    this.projects = new ProjectsService(env);
  }

  /** Lists doc filenames for a project straight off R2's native list() under
   *  the `{slug}/docs/` prefix — no D1 table, since R2 already gives us the
   *  key set cheaply and nothing here needs ordering or metadata beyond the
   *  filename itself. */
  async list(slug: string): Promise<string[]> {
    const prefix = r2PrefixFor(slug);
    const filenames: string[] = [];
    let cursor: string | undefined;

    do {
      const listed = await this.env.DAMS_BUCKET.list({ prefix, cursor });
      filenames.push(...listed.objects.map((o) => o.key.slice(prefix.length)));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    return filenames.sort();
  }

  async read(slug: string, filename: string): Promise<string | null> {
    const object = await this.env.DAMS_BUCKET.get(r2KeyFor(slug, filename));
    if (!object) return null;
    return object.text();
  }

  /** Creates the doc if it doesn't exist yet; otherwise appends `content` to
   *  the end with a `---` separator and a timestamp heading. R2 has no native
   *  append, so this is a read-modify-write, same trade-off as
   *  ProjectsService.appendMemory — fine for single-user traffic, not for
   *  concurrent writers to the same file. */
  async append(slug: string, filename: string, content: string): Promise<void> {
    if (!(await this.projects.get(slug))) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const key = r2KeyFor(slug, filename);
    const existing = await this.env.DAMS_BUCKET.get(key);

    if (!existing) {
      await this.env.DAMS_BUCKET.put(key, content);
      return;
    }

    const existingText = await existing.text();
    const timestamp = new Date().toISOString();
    const updatedText = `${existingText}\n\n---\n\n## ${timestamp}\n\n${content}`;
    await this.env.DAMS_BUCKET.put(key, updatedText);
  }

  /** Full-overwrite replace of an existing doc's content — deliberately NOT
   *  append. memory.jsonl is append-only because multi-device sync needs a
   *  conflict-free log; a doc is a single editable document a user asked to
   *  "update", not a revision log, so this replaces it in place. Fails if
   *  the doc doesn't exist yet, same convention as ProjectsService.updateEntity
   *  — creation stays append()'s job. */
  async update(slug: string, filename: string, content: string): Promise<void> {
    if (!(await this.projects.get(slug))) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const key = r2KeyFor(slug, filename);
    if (!(await this.env.DAMS_BUCKET.head(key))) {
      throw new Error(`Unknown doc: ${filename} (in project ${slug})`);
    }

    await this.env.DAMS_BUCKET.put(key, content);
  }

  /** Permanently deletes a doc file. Fails clearly if it doesn't exist. */
  async delete(slug: string, filename: string): Promise<void> {
    if (!(await this.projects.get(slug))) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const key = r2KeyFor(slug, filename);
    if (!(await this.env.DAMS_BUCKET.head(key))) {
      throw new Error(`Unknown doc: ${filename} (in project ${slug})`);
    }

    await this.env.DAMS_BUCKET.delete(key);
  }
}
