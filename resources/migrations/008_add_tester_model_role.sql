-- 008_add_tester_model_role.sql
-- Adds the tester role and default model mapping.
-- Tester defaults to Sonnet, while task execution remains Opus.

INSERT OR IGNORE INTO model_config (id, agent_role, model_id, updated_at)
VALUES ('mc-tester', 'tester', 'claude-sonnet-4-5', datetime('now'));

UPDATE model_config
SET model_id = 'claude-sonnet-4-5',
    updated_at = datetime('now')
WHERE agent_role = 'tester';
