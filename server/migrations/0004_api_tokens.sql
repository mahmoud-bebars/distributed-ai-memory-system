-- Replaces GitHub OAuth (/mcp) and bare reliance on Cloudflare Access
-- (/api/*) with one credential type: hashed, opaque bearer tokens. Tokens
-- are never stored raw, only their SHA-256 hex digest. A browser session
-- cookie's value is the raw token itself (no separate session table), so
-- revoking a row here invalidates both bearer use and any browser session
-- that was logged in with it.
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens (token_hash);
