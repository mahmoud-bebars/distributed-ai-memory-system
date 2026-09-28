import { z } from "zod";
import { expirationOptionSchema } from "../../lib/expiration";
import { slugSchema } from "../projects/schema";

// admin: everything, including token management (/api/tokens). read_write:
// the memory/doc mutating tools and REST routes. read_only: reads only
// (list/read/ask). Ordered weakest-to-strongest is NOT assumed anywhere —
// see middleware.ts's SCOPE_RANK for the actual hierarchy.
export const tokenScopeSchema = z.enum(["admin", "read_write", "read_only"]);
export type TokenScope = z.infer<typeof tokenScopeSchema>;

// A token's optional project allow-list: at least one slug, deduplicated,
// capped well above any realistic per-agent use case. Omitting this
// entirely (not passing `projects` at all) is what keeps today's
// all-projects behavior — an empty array is never a valid way to spell
// that, so it's rejected here rather than silently meaning something.
const MAX_TOKEN_PROJECTS = 50;

const tokenProjectsSchema = z
  .array(slugSchema)
  .min(1)
  .max(MAX_TOKEN_PROJECTS)
  .transform((slugs) => Array.from(new Set(slugs)));

export const createTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    scope: tokenScopeSchema,
    expiresIn: expirationOptionSchema.default("never"),
    projects: tokenProjectsSchema.optional(),
  })
  // Admin stays global by design — restricting the one scope that manages
  // tokens/projects themselves would just be a false sense of containment.
  // Tokens are immutable (see CLAUDE.md), so this is enforced only at
  // creation: revoke and recreate to change it.
  .refine((input) => input.scope !== "admin" || input.projects === undefined, {
    message: "Admin tokens cannot be restricted to specific projects",
    path: ["projects"],
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
  // Null means "all projects". Otherwise the exhaustive list of slugs this
  // credential may see or act on — checked via canAccessProject
  // (middleware.ts) everywhere a project is looked up by slug.
  projects: string[] | null;
}

export type { ApiTokenRow as TokenRow } from "../../db/schema";
