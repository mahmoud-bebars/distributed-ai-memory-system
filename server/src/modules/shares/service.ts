import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { projectShares, type ProjectRow, type ProjectShareRow } from "../../db/schema";
import type { Bindings } from "../../lib/bindings";
import { ProjectsService } from "../projects";
import type { CreateShareLinkInput, ExpirationOption, UpdateShareLinkInput } from "./schema";

// If env.SHARE_HOSTNAME is set, it's the one hostname deliberately left
// outside whatever access control protects your main domain (see
// CLAUDE.md's share-link notes) — share links resolve there instead of on
// the access-gated host. If it's unset, share links just resolve on
// whatever host served the request that's building this URL.
export const shareUrl = (token: string, env: Bindings, requestHost: string): string =>
  `https://${env.SHARE_HOSTNAME || requestHost}/share/${token}`;

const EXPIRATION_MS: Record<ExpirationOption, number | null> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  never: null,
};

// Always computed fresh from "now" at create/update time — editing a link's
// expiration to "7 days" means "7 days from whenever you saved that", not
// an extension of whatever expiry it had before.
function computeExpiresAt(option: ExpirationOption): string | null {
  const ms = EXPIRATION_MS[option];
  return ms === null ? null : new Date(Date.now() + ms).toISOString();
}

function isExpired(share: ProjectShareRow): boolean {
  return share.expiresAt !== null && new Date(share.expiresAt).getTime() <= Date.now();
}

export class SharesService {
  private readonly db: DrizzleD1Database;
  private readonly projects: ProjectsService;

  constructor(private readonly env: Bindings) {
    this.db = drizzle(env.DAMS_DB);
    this.projects = new ProjectsService(env);
  }

  /** All share links for a project, newest first — including expired ones,
   *  so the owner's management view can show "expired" rather than have
   *  links silently vanish. Only the public resolve path below treats an
   *  expired link as gone. */
  async list(slug: string): Promise<ProjectShareRow[]> {
    return this.db
      .select()
      .from(projectShares)
      .where(eq(projectShares.slug, slug))
      .orderBy(desc(projectShares.createdAt));
  }

  async create(slug: string, input: CreateShareLinkInput): Promise<ProjectShareRow> {
    if (!(await this.projects.get(slug))) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const token = crypto.randomUUID();
    await this.db.insert(projectShares).values({
      token,
      slug,
      label: input.label?.trim() || null,
      allowChat: input.allowChat,
      allowDocs: input.allowDocs,
      expiresAt: computeExpiresAt(input.expiresIn),
    });

    return (await this.getByToken(token))!;
  }

  /** Label/allowChat/allowDocs are a full replace. Expiration is the one
   *  exception: omitting `expiresIn` leaves the link's current expiry
   *  untouched rather than resetting it to "never" — see
   *  updateShareLinkSchema's comment. Fails clearly if the token doesn't
   *  belong to this project (or doesn't exist at all) — same "unknown X"
   *  convention as ProjectsService/DocsService. */
  async update(slug: string, token: string, input: UpdateShareLinkInput): Promise<ProjectShareRow> {
    const existing = await this.getByToken(token);
    if (!existing || existing.slug !== slug) {
      throw new Error(`Unknown share link: ${token}`);
    }

    await this.db
      .update(projectShares)
      .set({
        label: input.label?.trim() || null,
        allowChat: input.allowChat,
        allowDocs: input.allowDocs,
        expiresAt: input.expiresIn === undefined ? existing.expiresAt : computeExpiresAt(input.expiresIn),
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(projectShares.token, token));

    return (await this.getByToken(token))!;
  }

  async revoke(slug: string, token: string): Promise<void> {
    await this.db
      .delete(projectShares)
      .where(and(eq(projectShares.token, token), eq(projectShares.slug, slug)));
  }

  private async getByToken(token: string): Promise<ProjectShareRow | null> {
    const rows = await this.db.select().from(projectShares).where(eq(projectShares.token, token)).limit(1);
    return rows[0] ?? null;
  }

  /** Resolves a share token to its project + link settings, or null if the
   *  token doesn't exist, doesn't match a project anymore, OR has expired —
   *  callers must fold all three into the same plain 404, never
   *  distinguishing "expired" from "never existed" in the response. */
  async resolveByToken(token: string): Promise<{ project: ProjectRow; share: ProjectShareRow } | null> {
    const share = await this.getByToken(token);
    if (!share || isExpired(share)) return null;

    const project = await this.projects.get(share.slug);
    if (!project) return null;

    return { project, share };
  }
}
