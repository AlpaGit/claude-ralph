-- 016_queue_parallel_enabled.sql
-- Adds app setting to control queue parallel execution mode.

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('queue_parallel_enabled', '1', datetime('now'));
