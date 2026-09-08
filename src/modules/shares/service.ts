import { eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { projectShares, type ProjectRow, type ProjectShareRow } from "../../db/schema";
import type { Bindings } from "../../lib/bindings";
import { ProjectsService } from "../projects";
import type { ShareStatus } from "./schema";

// mcp.mahmoudbebars.dev is the one hostname deliberately left outside
// Cloudflare Access (see wrangler.toml's routes and CLAUDE.md's share-link
// notes) — share links must resolve there, never on the Access-gated
// memory.mahmoudbebars.dev host.
const SHARE_HOST = "mcp.mahmoudbebars.dev";

export const shareUrl = (token: string): string => `https://${SHARE_HOST}/share/${token}`;

export class SharesService {
  private readonly db: DrizzleD1Database;
  private readonly projects: ProjectsService;

  constructor(private readonly env: Bindings) {
    this.db = drizzle(env.DAMS_DB);
    this.projects = new ProjectsService(env);
  }

  async status(slug: string): Promise<ShareStatus> {
    const share = await this.get(slug);
    return share ? { active: true, token: share.token, url: shareUrl(share.token) } : { active: false };
  }

  private async get(slug: string): Promise<ProjectShareRow | null> {
    const rows = await this.db.select().from(projectShares).where(eq(projectShares.slug, slug)).limit(1);
    return rows[0] ?? null;
  }

  /** Generates a new unguessable token and upserts it as the project's one
   *  active share — a fresh call here is how "regenerate" works too, since
   *  it replaces whatever token existed before. */
  async create(slug: string): Promise<{ token: string; url: string }> {
    if (!(await this.projects.get(slug))) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const token = crypto.randomUUID();
    await this.db
      .insert(projectShares)
      .values({ slug, token })
      .onConflictDoUpdate({
        target: projectShares.slug,
        set: { token, createdAt: sql`(datetime('now'))` },
      });

    return { token, url: shareUrl(token) };
  }

  async revoke(slug: string): Promise<void> {
    await this.db.delete(projectShares).where(eq(projectShares.slug, slug));
  }

  /** Resolves a share token to its project, or null if the token doesn't
   *  match anything — callers should turn that into a plain 404 without
   *  distinguishing "no such token" from any other failure. */
  async resolveProjectByToken(token: string): Promise<ProjectRow | null> {
    const rows = await this.db.select().from(projectShares).where(eq(projectShares.token, token)).limit(1);
    const share = rows[0];
    if (!share) return null;
    return this.projects.get(share.slug);
  }
}
