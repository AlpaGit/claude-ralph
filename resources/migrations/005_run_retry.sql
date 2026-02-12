-- 005_run_retry.sql
-- Add retry_count column to runs table and 'skipped' as a valid task status.
-- retry_count tracks how many times a task has been retried for a given run lineage.

ALTER TABLE runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
