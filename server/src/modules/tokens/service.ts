import { desc, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { apiTokens, type NewApiTokenRow } from "../../db/schema";
import { computeExpiresAt } from "../../lib/expiration";
import type { Bindings } from "../../lib/bindings";
import type { CreateTokenInput, TokenAuth, TokenRow, TokenScope } from "./schema";

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `dams_${base64UrlFromBytes(bytes)}`;
}

// Exported so middleware.ts can hash env.DAMS_ADMIN_TOKEN and a presented
// credential to the same fixed-length digest before comparing them —
// turning a variable-length string compare (which leaks timing on the
// first mismatched byte) into a fixed-size one.
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return toHex(digest);
}

export class TokensService {
  private readonly db: DrizzleD1Database;

  constructor(private readonly env: Bindings) {
    this.db = drizzle(env.DAMS_DB);
  }

  /** The raw token is returned once, here, and never again — only its hash
   *  is persisted. */
  async create(input: CreateTokenInput): Promise<{ token: string; row: TokenRow }> {
    const raw = generateRawToken();
    const row: NewApiTokenRow = {
      id: crypto.randomUUID(),
      name: input.name,
      tokenHash: await hashToken(raw),
      scope: input.scope,
      expiresAt: computeExpiresAt(input.expiresIn),
    };
    await this.db.insert(apiTokens).values(row);
    return { token: raw, row: (await this.getById(row.id))! };
  }

  async getById(id: string): Promise<TokenRow | null> {
    const rows = await this.db.select().from(apiTokens).where(eq(apiTokens.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async list(): Promise<TokenRow[]> {
    return this.db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt));
  }

  async revoke(id: string): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({ revokedAt: sql`(datetime('now'))` })
      .where(eq(apiTokens.id, id));
  }

  /** Fire-and-forget from the auth middleware via ctx.waitUntil — never on
   *  the request's own critical path. */
  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({ lastUsedAt: sql`(datetime('now'))` })
      .where(eq(apiTokens.id, id));
  }

  /** Resolves a raw token to its current auth identity, or null if it
   *  doesn't exist, has been revoked, or has expired — callers never need
   *  to (and never should) distinguish those cases from each other. */
  async verify(raw: string): Promise<TokenAuth | null> {
    const row = await this.getByHash(await hashToken(raw));
    if (!row || row.revokedAt !== null) return null;
    if (row.expiresAt !== null && new Date(row.expiresAt).getTime() <= Date.now()) return null;
    return { id: row.id, name: row.name, scope: row.scope as TokenScope };
  }

  private async getByHash(tokenHash: string): Promise<TokenRow | null> {
    const rows = await this.db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).limit(1);
    return rows[0] ?? null;
  }
}
