import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Bindings {
  DAMS_DB: D1Database;
  DAMS_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;

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
