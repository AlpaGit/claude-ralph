-- 010_add_committer_model_role.sql
-- Adds the committer role and default model mapping.
-- Committer defaults to Sonnet.

INSERT OR IGNORE INTO model_config (id, agent_role, model_id, updated_at)
VALUES ('mc-committer', 'committer', 'claude-sonnet-4-5', datetime('now'));

UPDATE model_config
SET model_id = 'claude-sonnet-4-5',
    updated_at = datetime('now')
WHERE agent_role = 'committer';
