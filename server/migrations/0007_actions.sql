-- Phase 2 of the cross-project assistant: typed actions with human approval.
--
-- A plan is proposed (REST, MCP, or the assistant), validated in code, stored
-- as 'pending', and only ever executed after an admin approves it. These
-- tables are the audit trail too: nothing here is deleted, and every state
-- change also lands in audit_log.

-- Soft archive: hides a project from cross-project search by default, never
-- deletes anything. Reversible with update_project { archived: false }.
ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS action_plans (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed | rejected
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',   -- JSON array of {slug, entryId}
  source TEXT NOT NULL,                   -- api | mcp | agent
  proposed_by TEXT NOT NULL,              -- token name
  approved_by TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_action_plans_status ON action_plans (status, created_at);

CREATE TABLE IF NOT EXISTS plan_actions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES action_plans (id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,                  -- JSON of the validated action
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
  result TEXT,                            -- JSON
  inverse TEXT,                           -- JSON: how to undo it (recorded, not yet executable)
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_actions_plan ON plan_actions (plan_id, seq);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  plan_id TEXT,
  action_id TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_plan ON audit_log (plan_id);
