-- 001_initial.sql
-- Initial schema for Ralph Desktop Orchestrator.
-- Uses IF NOT EXISTS guards so this migration is safe to apply on existing databases.

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  prd_text TEXT NOT NULL,
  summary TEXT NOT NULL,
  technical_pack_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL,
  technical_notes TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  total_cost_usd REAL,
  result_text TEXT,
  stop_reason TEXT,
  error_text TEXT,
  FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS todo_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  total INTEGER NOT NULL,
  pending INTEGER NOT NULL,
  in_progress INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  todos_json TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_plan_ordinal ON tasks(plan_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_runs_task_started ON runs(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_events_run_ts ON run_events(run_id, ts);
