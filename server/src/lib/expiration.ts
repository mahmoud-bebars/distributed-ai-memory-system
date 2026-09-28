import { z } from "zod";

// Shared by shares/schema.ts (share links) and tokens/schema.ts (API
// tokens) — both attach an optional, duration-based expiration to a row
// they create.
export const expirationOptionSchema = z.enum(["1d", "7d", "30d", "90d", "never"]);
export type ExpirationOption = z.infer<typeof expirationOptionSchema>;

const EXPIRATION_MS: Record<ExpirationOption, number | null> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  never: null,
};

// Always computed fresh from "now" at create/update time — setting an
// expiration to "7 days" means "7 days from whenever you saved that", not
// an extension of whatever expiry existed before.
export function computeExpiresAt(option: ExpirationOption): string | null {
  const ms = EXPIRATION_MS[option];
  return ms === null ? null : new Date(Date.now() + ms).toISOString();
}
