-- 011_app_settings.sql
-- Adds app_settings key/value table and seeds webhook setting.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('discord_webhook_url', '', datetime('now'));
