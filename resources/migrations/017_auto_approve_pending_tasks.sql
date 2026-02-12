-- 017_auto_approve_pending_tasks.sql
-- Adds app setting to auto-approve architecture follow-up proposals into tasks.

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('auto_approve_pending_tasks', '0', datetime('now'));
