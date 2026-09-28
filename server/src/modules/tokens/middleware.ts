import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "../../lib/bindings";
import { hashToken, TokensService } from "./service";
import type { TokenAuth, TokenScope } from "./schema";

export const SESSION_COOKIE_NAME = "dams_session";

const SCOPE_RANK: Record<TokenScope, number> = { read_only: 0, read_write: 1, admin: 2 };

function scopeAtLeast(actual: TokenScope, required: TokenScope): boolean {
  return SCOPE_RANK[actual] >= SCOPE_RANK[required];
}

// Both sides hashed to the same fixed-length digest before comparing, so a
// mismatch can't be timed byte-by-byte the way a raw string compare could.
async function matchesAdminToken(raw: string, env: Bindings): Promise<boolean> {
  if (!env.DAMS_ADMIN_TOKEN) return false;
  const [a, b] = await Promise.all([hashToken(raw), hashToken(env.DAMS_ADMIN_TOKEN)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Resolves a raw credential string to a TokenAuth, or null if it's
 *  missing/invalid/revoked/expired. Shared by authenticate() below (which
 *  pulls the raw value from a request) and the /api/auth/login route
 *  (which gets it straight from the request body, before any cookie
 *  exists). */
export async function resolveToken(raw: string, env: Bindings): Promise<TokenAuth | null> {
  if (await matchesAdminToken(raw, env)) {
    return { id: null, name: "admin-bootstrap", scope: "admin" };
  }
  return new TokensService(env).verify(raw);
}

/** Resolves whatever credential a request carries (bearer header takes
 *  priority, then the session cookie) to a TokenAuth. Used by
 *  requireApiAuth below and the /api/auth/me route. */
export async function authenticate<E extends { Bindings: Bindings }>(
  c: Context<E>,
): Promise<TokenAuth | null> {
  const header = c.req.header("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const raw = bearer ?? getCookie(c, SESSION_COOKIE_NAME) ?? null;
  return raw ? resolveToken(raw, c.env) : null;
}

/** Hono middleware factory. `minScope` defaults to method-based: GET/HEAD
 *  need `read_only`, everything else needs `read_write` — pass it
 *  explicitly (e.g. "admin" for /api/tokens, "read_only" for /mcp, which is
 *  all POST regardless of which underlying tool is being called) to
 *  override that default. */
export function requireApiAuth(opts?: { minScope?: TokenScope }): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: { tokenAuth: TokenAuth };
}> {
  return async (c, next) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);

    const needed =
      opts?.minScope ?? (c.req.method === "GET" || c.req.method === "HEAD" ? "read_only" : "read_write");
    if (!scopeAtLeast(auth.scope, needed)) return c.json({ error: "Forbidden" }, 403);

    c.set("tokenAuth", auth);
    if (auth.id !== null) {
      c.executionCtx.waitUntil(new TokensService(c.env).touchLastUsed(auth.id));
    }
    return next();
  };
}
