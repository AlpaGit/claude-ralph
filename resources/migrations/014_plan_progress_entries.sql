-- 014_plan_progress_entries.sql
-- Stores per-plan progress history that replaces global progress.txt context.

CREATE TABLE IF NOT EXISTS plan_progress_entries (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  entry_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_progress_entries_plan_created_at
  ON plan_progress_entries(plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_progress_entries_run
  ON plan_progress_entries(run_id);
