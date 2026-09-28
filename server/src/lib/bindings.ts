export interface Bindings {
  DAMS_DB: D1Database;
  DAMS_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;

  // "development" locally (wrangler dev), unset/"production" when deployed —
  // gates the session cookie's Secure attribute (see modules/tokens/routes.ts),
  // since browsers reject Secure cookies over plain http.
  ENVIRONMENT?: string;

  // Break-glass / bootstrap credential for the token-based auth layer (see
  // modules/tokens). Always resolves to admin scope, constant-time-compared,
  // never a database row — set once with `wrangler secret put
  // DAMS_ADMIN_TOKEN`, log in with it, then create real tokens and (per
  // taste) stop using it day-to-day.
  DAMS_ADMIN_TOKEN: string;

  // Optional. The one hostname (if any) you've deliberately left outside
  // whatever access control sits in front of your main domain, so that
  // unauthenticated recipients of a share link — and MCP clients hitting
  // /mcp — can still be reached. See CLAUDE.md's "Shareable read-only
  // links" section. Leave unset if you don't have a separate access-gated
  // domain; share links then just resolve on whatever host served the
  // request, and the host-guard middleware in index.ts is skipped entirely.
  SHARE_HOSTNAME?: string;
}
