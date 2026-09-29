-- Phase 3 of the cross-project assistant: the global chat, and tasks as
-- persistent, visible state. D1 is the source of truth for all of it —
-- Workflow state is only kept 3 days on the Free plan, so Workflows carry
-- out work (plan execution) but never own task state.

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  role TEXT NOT NULL,               -- user | assistant
  kind TEXT NOT NULL DEFAULT 'text',-- text | answer | ask | plan
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]', -- JSON [{slug, entryId, ...}]
  plan_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  -- planning | awaiting_approval | running | done | failed | cancelled | expired
  status TEXT NOT NULL DEFAULT 'planning',
  plan_id TEXT REFERENCES action_plans (id),
  current_step TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status, updated_at);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  at TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events (task_id, id);
