-- Replaces the one-link-per-project share model with multiple,
-- independently configured links per project (label, chat/docs toggles,
-- expiry). Breaking schema change on a table that only ever held at most
-- one row per project in practice, so a straight drop+recreate is simpler
-- than migrating rows in place.
DROP TABLE IF EXISTS project_shares;

CREATE TABLE IF NOT EXISTS project_shares (
  token TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES projects (slug),
  label TEXT,
  allow_chat INTEGER NOT NULL DEFAULT 0,
  allow_docs INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_shares_slug ON project_shares (slug);
