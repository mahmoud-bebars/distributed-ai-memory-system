-- Phase 1 of the cross-project assistant: hybrid (vector + keyword) search.
--
-- Everything below is a DERIVED index — fully rebuildable from each
-- project's R2 memory.jsonl (POST /api/search/reindex), so it stays
-- consistent with "D1 is an index, not a data store". Losing these tables
-- loses nothing but search quality until the next reindex.

-- Privacy flag: a project is invisible to cross-project search and to the
-- global assistant unless this is 1 (or the request names it explicitly).
-- Default 0 — existing projects opt in deliberately.
ALTER TABLE projects ADD COLUMN include_in_global_search INTEGER NOT NULL DEFAULT 0;

-- Keyword half of the hybrid index. `key` is the stable index key (a hash of
-- project + entry identity — see modules/search/text.ts), `entry_id` is the
-- memory entry's real id (what citations point at). Only `content` is
-- tokenized; unicode61 handles Arabic. Note: D1 can't export a database that
-- contains FTS5 virtual tables — back up memory.jsonl from R2 instead.
CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts USING fts5(
  key UNINDEXED,
  entry_id UNINDEXED,
  project_slug UNINDEXED,
  content,
  created_at UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Per-entry indexing state, so a failed/paused embedding never blocks a write
-- and the cron sweep knows what to retry. `vectorized` = 0 with status
-- 'indexed' means the keyword half is done but no vector exists yet (no
-- Vectorize/AI binding, or the embedding budget ran out).
CREATE TABLE IF NOT EXISTS entry_index_status (
  key TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | indexed | failed
  vectorized INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entry_index_status_status ON entry_index_status (status, vectorized);
CREATE INDEX IF NOT EXISTS idx_entry_index_status_project ON entry_index_status (project_slug);

-- Daily usage counters for the free-tier budget guards: 'ai_tokens'
-- (Workers AI embeddings, estimated) and 'llm_tokens' (Anthropic).
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
