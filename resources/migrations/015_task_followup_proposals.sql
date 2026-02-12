-- 015_task_followup_proposals.sql
-- Stores optional architecture follow-up tasks that users can approve before execution.

CREATE TABLE IF NOT EXISTS task_followup_proposals (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  source_run_id TEXT,
  source_task_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  rule TEXT NOT NULL,
  location TEXT NOT NULL,
  message TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL,
  technical_notes TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  FOREIGN KEY(source_run_id) REFERENCES runs(id) ON DELETE SET NULL,
  FOREIGN KEY(source_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(approved_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  UNIQUE(plan_id, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_task_followup_proposals_plan_status_created
  ON task_followup_proposals(plan_id, status, created_at DESC);
