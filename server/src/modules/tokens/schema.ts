import { z } from "zod";
import { expirationOptionSchema } from "../../lib/expiration";

// admin: everything, including token management (/api/tokens). read_write:
// the memory/doc mutating tools and REST routes. read_only: reads only
// (list/read/ask). Ordered weakest-to-strongest is NOT assumed anywhere —
// see middleware.ts's SCOPE_RANK for the actual hierarchy.
export const tokenScopeSchema = z.enum(["admin", "read_write", "read_only"]);
export type TokenScope = z.infer<typeof tokenScopeSchema>;

export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(200),
  scope: tokenScopeSchema,
  expiresIn: expirationOptionSchema.default("never"),
});
export type CreateTokenInput = z.infer<typeof createTokenSchema>;

export const loginSchema = z.object({
  token: z.string().trim().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// What a verified credential (bearer header, session cookie, or the
// DAMS_ADMIN_TOKEN bootstrap secret) resolves to. `id` is null for the
// bootstrap secret, which isn't a database row.
export interface TokenAuth {
  id: string | null;
  name: string;
  scope: TokenScope;
}

export type { ApiTokenRow as TokenRow } from "../../db/schema";
