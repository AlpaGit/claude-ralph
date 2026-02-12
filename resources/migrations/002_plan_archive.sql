-- 002_plan_archive.sql
-- Adds archived_at column to plans table for soft-archive support.
-- NULL means the plan is not archived; an ISO-8601 timestamp means it is.

ALTER TABLE plans ADD COLUMN archived_at TEXT;
