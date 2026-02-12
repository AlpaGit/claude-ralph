-- 013_projects_table.sql
-- Introduces canonical projects table with stable IDs and metadata.
-- Migrates project matching for plans/discovery_sessions to project_id.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL UNIQUE,
  canonical_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  stack_profile_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_stack_refresh_at TEXT
);

ALTER TABLE plans ADD COLUMN project_id TEXT;
ALTER TABLE discovery_sessions ADD COLUMN project_id TEXT;

-- Normalize legacy project_key values for reliable migration joins.
UPDATE plans
SET project_key = lower(trim(replace(project_path, '\\', '/')))
WHERE trim(project_path) <> '';

UPDATE discovery_sessions
SET project_key = lower(trim(replace(project_path, '\\', '/')))
WHERE trim(project_path) <> '';

-- Seed projects from existing project_profiles first (includes stack/profile context).
INSERT INTO projects (
  id,
  project_key,
  canonical_path,
  display_name,
  metadata_json,
  stack_profile_json,
  created_at,
  updated_at,
  last_stack_refresh_at
)
SELECT
  'proj-' || lower(hex(randomblob(16))) AS id,
  pp.project_key,
  pp.project_path,
  pp.project_path,
  COALESCE(pp.context_json, '{}') AS metadata_json,
  pp.stack_profile_json,
  pp.created_at,
  pp.updated_at,
  CASE WHEN pp.stack_profile_json IS NOT NULL THEN pp.updated_at ELSE NULL END
FROM project_profiles pp
WHERE pp.project_key IS NOT NULL
  AND trim(pp.project_key) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.project_key = pp.project_key
  );

-- Seed any remaining projects referenced only by plans.
INSERT INTO projects (
  id,
  project_key,
  canonical_path,
  display_name,
  metadata_json,
  stack_profile_json,
  created_at,
  updated_at,
  last_stack_refresh_at
)
SELECT
  'proj-' || lower(hex(randomblob(16))) AS id,
  psrc.project_key,
  psrc.canonical_path,
  psrc.canonical_path,
  '{}' AS metadata_json,
  NULL AS stack_profile_json,
  psrc.created_at,
  psrc.updated_at,
  NULL AS last_stack_refresh_at
FROM (
  SELECT
    COALESCE(NULLIF(trim(project_key), ''), lower(trim(replace(project_path, '\\', '/')))) AS project_key,
    MIN(project_path) AS canonical_path,
    MIN(created_at) AS created_at,
    MAX(updated_at) AS updated_at
  FROM plans
  WHERE trim(project_path) <> ''
  GROUP BY COALESCE(NULLIF(trim(project_key), ''), lower(trim(replace(project_path, '\\', '/'))))
) AS psrc
WHERE psrc.project_key IS NOT NULL
  AND trim(psrc.project_key) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.project_key = psrc.project_key
  );

-- Seed any remaining projects referenced only by discovery sessions.
INSERT INTO projects (
  id,
  project_key,
  canonical_path,
  display_name,
  metadata_json,
  stack_profile_json,
  created_at,
  updated_at,
  last_stack_refresh_at
)
SELECT
  'proj-' || lower(hex(randomblob(16))) AS id,
  dsrc.project_key,
  dsrc.canonical_path,
  dsrc.canonical_path,
  '{}' AS metadata_json,
  NULL AS stack_profile_json,
  dsrc.created_at,
  dsrc.updated_at,
  NULL AS last_stack_refresh_at
FROM (
  SELECT
    COALESCE(NULLIF(trim(project_key), ''), lower(trim(replace(project_path, '\\', '/')))) AS project_key,
    MIN(project_path) AS canonical_path,
    MIN(created_at) AS created_at,
    MAX(updated_at) AS updated_at
  FROM discovery_sessions
  WHERE trim(project_path) <> ''
  GROUP BY COALESCE(NULLIF(trim(project_key), ''), lower(trim(replace(project_path, '\\', '/'))))
) AS dsrc
WHERE dsrc.project_key IS NOT NULL
  AND trim(dsrc.project_key) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.project_key = dsrc.project_key
  );

-- Backfill FK-style linkage for plans/discovery sessions.
UPDATE plans
SET project_id = (
  SELECT p.id
  FROM projects p
  WHERE p.project_key = COALESCE(NULLIF(trim(plans.project_key), ''), lower(trim(replace(plans.project_path, '\\', '/'))))
)
WHERE project_id IS NULL OR project_id = '';

UPDATE discovery_sessions
SET project_id = (
  SELECT p.id
  FROM projects p
  WHERE p.project_key = COALESCE(NULLIF(trim(discovery_sessions.project_key), ''), lower(trim(replace(discovery_sessions.project_path, '\\', '/'))))
)
WHERE project_id IS NULL OR project_id = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_project_key ON projects(project_key);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_last_stack_refresh ON projects(last_stack_refresh_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_project_id ON plans(project_id);
CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project_id ON discovery_sessions(project_id);
