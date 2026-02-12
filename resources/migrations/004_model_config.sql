-- 004_model_config.sql
-- Creates model_config table for agent-role-to-model mapping.
-- Seed rows use INSERT OR IGNORE so re-running the migration is idempotent.

CREATE TABLE IF NOT EXISTS model_config (
  id TEXT PRIMARY KEY,
  agent_role TEXT UNIQUE NOT NULL,
  model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO model_config (id, agent_role, model_id, updated_at)
VALUES
  ('mc-discovery-specialist', 'discovery_specialist', 'claude-sonnet-4-20250514', datetime('now')),
  ('mc-plan-synthesis',      'plan_synthesis',        'claude-sonnet-4-20250514', datetime('now')),
  ('mc-task-execution',      'task_execution',        'claude-opus-4-20250514',   datetime('now'));
