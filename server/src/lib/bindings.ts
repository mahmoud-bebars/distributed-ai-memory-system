import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Bindings {
  DAMS_DB: D1Database;
  DAMS_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;

  // Optional. The one hostname (if any) you've deliberately left outside
  // whatever access control sits in front of your main domain, so that
  // unauthenticated recipients of a share link — and the /mcp OAuth flow —
  // can still be reached. See CLAUDE.md's "Shareable read-only links"
  // section. Leave unset if you don't have a separate access-gated domain;
  // share links then just resolve on whatever host served the request, and
  // the host-guard middleware in index.ts is skipped entirely.
  SHARE_HOSTNAME?: string;

  // OAuth for the /mcp route only (see src/modules/auth). The REST API and
  // web UI don't touch any of these — they're consumed exclusively by
  // @cloudflare/workers-oauth-provider and the GitHub auth handler.
  OAUTH_KV: KVNamespace;
  // Injected by the OAuthProvider into every wrapped handler's env at
  // runtime — the provider's helper surface (parseAuthRequest,
  // completeAuthorization, lookupClient, …).
  OAUTH_PROVIDER: OAuthHelpers;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  // Single allow-listed GitHub login permitted to complete the OAuth flow.
  ALLOWED_GITHUB_USER: string;
}
