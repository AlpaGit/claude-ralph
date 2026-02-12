-- 012_project_profiles.sql
-- Introduces per-project persistence keyed by normalized project path.
-- This enables cross-plan/project memory such as cached stack profiles.

CREATE TABLE IF NOT EXISTS project_profiles (
  project_key TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  stack_profile_json TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE plans ADD COLUMN project_key TEXT;
ALTER TABLE discovery_sessions ADD COLUMN project_key TEXT;

UPDATE plans
SET project_key = lower(trim(project_path))
WHERE project_key IS NULL OR project_key = '';

UPDATE discovery_sessions
SET project_key = lower(trim(project_path))
WHERE project_key IS NULL OR project_key = '';

INSERT INTO project_profiles (project_key, project_path, stack_profile_json, context_json, created_at, updated_at)
SELECT DISTINCT lower(trim(project_path)) AS project_key,
                project_path,
                NULL AS stack_profile_json,
                '{}' AS context_json,
                datetime('now') AS created_at,
                datetime('now') AS updated_at
FROM plans
WHERE trim(project_path) <> ''
  AND lower(trim(project_path)) NOT IN (SELECT project_key FROM project_profiles);

CREATE INDEX IF NOT EXISTS idx_plans_project_key ON plans(project_key);
CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project_key ON discovery_sessions(project_key);
CREATE INDEX IF NOT EXISTS idx_project_profiles_project_path ON project_profiles(project_path);
