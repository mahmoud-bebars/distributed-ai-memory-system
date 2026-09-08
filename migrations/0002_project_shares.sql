CREATE TABLE IF NOT EXISTS project_shares (
  slug TEXT PRIMARY KEY REFERENCES projects (slug),
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_shares_token ON project_shares (token);
