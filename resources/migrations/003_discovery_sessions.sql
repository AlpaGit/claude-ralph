-- 003_discovery_sessions.sql
-- Creates discovery_sessions table for persisting discovery interview state.
-- latest_state_json stores the full DiscoveryInterviewState object serialized,
-- allowing complete state restoration on resume.
-- answer_history_json is an array of all answers across all rounds.

CREATE TABLE IF NOT EXISTS discovery_sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  seed_sentence TEXT NOT NULL,
  additional_context TEXT NOT NULL DEFAULT '',
  answer_history_json TEXT NOT NULL DEFAULT '[]',
  round_number INTEGER NOT NULL DEFAULT 1,
  latest_state_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_status ON discovery_sessions(status);
CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project ON discovery_sessions(project_path);
