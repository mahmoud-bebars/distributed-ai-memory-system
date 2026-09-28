import { zValidator } from "@hono/zod-validator";
import { deleteCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Bindings } from "../../lib/bindings";
import { requireApiAuth, resolveToken, SESSION_COOKIE_NAME } from "./middleware";
import { createTokenSchema, loginSchema, type TokenRow } from "./schema";
import { TokensService } from "./service";

// Chrome's own cap on Set-Cookie Max-Age — used as the session lifetime for
// a never-expiring token, since there's no such thing as an infinite
// cookie.
const MAX_SESSION_AGE_SECONDS = 400 * 24 * 60 * 60;

function sessionMaxAge(expiresAt: string | null): number {
  if (expiresAt === null) return MAX_SESSION_AGE_SECONDS;
  const remainingSeconds = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  return Math.max(0, Math.min(remainingSeconds, MAX_SESSION_AGE_SECONDS));
}

type AppEnv = { Bindings: Bindings; Variables: { tokenAuth: import("./schema").TokenAuth } };

// Mounted at /api/auth. Only /login and /logout are reachable without a
// credential already — index.ts's blanket requireApiAuth on /api/projects
// and /api/tokens never applies here, this router handles its own auth
// inline (or, for /me, via requireApiAuth) so login is actually reachable.
export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const { token } = c.req.valid("json");
  const auth = await resolveToken(token, c.env);
  if (!auth) return c.json({ error: "Invalid token" }, 401);

  // The bootstrap secret has no row/expiry of its own — falls back to the
  // max session lifetime, same as a never-expiring real token.
  const row = auth.id === null ? null : await new TokensService(c.env).getById(auth.id);
  const expiresAt = row?.expiresAt ?? null;

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== "development",
    sameSite: "Lax",
    path: "/",
    maxAge: sessionMaxAge(expiresAt),
  });
  return c.json({ name: auth.name, scope: auth.scope });
});

authRoutes.post("/logout", async (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", requireApiAuth({ minScope: "read_only" }), async (c) => {
  const auth = c.get("tokenAuth");
  return c.json({ name: auth.name, scope: auth.scope });
});

// Mounted at /api/tokens, gated admin-only by requireApiAuth in index.ts.
export const tokenManagementRoutes = new Hono<AppEnv>();

// TokenRow stores `projects` as a JSON-encoded string (or null); the API
// shape is the parsed array (or null) instead, matching CreateTokenInput.
function serializeTokenRow({ tokenHash: _tokenHash, projects, ...row }: TokenRow) {
  return { ...row, projects: projects ? (JSON.parse(projects) as string[]) : null };
}

tokenManagementRoutes.get("/", async (c) => {
  const tokens = new TokensService(c.env);
  const rows = await tokens.list();
  return c.json(rows.map(serializeTokenRow));
});

tokenManagementRoutes.post("/", zValidator("json", createTokenSchema), async (c) => {
  const tokens = new TokensService(c.env);
  const { token, row } = await tokens.create(c.req.valid("json"));
  // The raw token is shown exactly once, in this response — it can never be
  // retrieved again afterward, only revoked and replaced with a new one.
  return c.json({ token, ...serializeTokenRow(row) }, 201);
});

tokenManagementRoutes.delete("/:id", async (c) => {
  await new TokensService(c.env).revoke(c.req.param("id"));
  return c.json({ ok: true });
});
