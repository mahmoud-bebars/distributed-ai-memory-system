CREATE TABLE IF NOT EXISTS projects (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  tags TEXT,             -- JSON-encoded string array
  r2_key TEXT NOT NULL,  -- e.g. "ghoraf/memory.jsonl"
  entity_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at);
