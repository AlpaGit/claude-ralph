-- 009_add_architecture_specialist_model_role.sql
-- Adds the architecture specialist role and default model mapping.
-- Architecture specialist defaults to Sonnet.

INSERT OR IGNORE INTO model_config (id, agent_role, model_id, updated_at)
VALUES ('mc-architecture-specialist', 'architecture_specialist', 'claude-sonnet-4-5', datetime('now'));

UPDATE model_config
SET model_id = 'claude-sonnet-4-5',
    updated_at = datetime('now')
WHERE agent_role = 'architecture_specialist';
