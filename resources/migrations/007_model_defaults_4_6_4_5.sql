-- 007_model_defaults_4_6_4_5.sql
-- Enforces preferred model routing:
--   - task_execution -> claude-opus-4-6
--   - discovery_specialist/plan_synthesis/architecture_specialist/tester/committer -> claude-sonnet-4-5

UPDATE model_config
SET model_id = 'claude-sonnet-4-5',
    updated_at = datetime('now')
WHERE agent_role IN ('discovery_specialist', 'plan_synthesis');

UPDATE model_config
SET model_id = 'claude-sonnet-4-5',
    updated_at = datetime('now')
WHERE agent_role = 'architecture_specialist';

UPDATE model_config
SET model_id = 'claude-sonnet-4-5',
    updated_at = datetime('now')
WHERE agent_role = 'tester';

UPDATE model_config
SET model_id = 'claude-sonnet-4-5',
    updated_at = datetime('now')
WHERE agent_role = 'committer';

UPDATE model_config
SET model_id = 'claude-opus-4-6',
    updated_at = datetime('now')
WHERE agent_role = 'task_execution';
