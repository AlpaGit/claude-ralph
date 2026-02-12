-- 006_run_events_pagination.sql
-- Adds a composite index on run_events(run_id, ts, id) to support efficient
-- cursor-based pagination in getRunEvents(). The existing idx_run_events_run_ts
-- index covers (run_id, ts) but the cursor query also uses id as a tie-breaker
-- when multiple events share the same timestamp.

CREATE INDEX IF NOT EXISTS idx_run_events_run_ts_id ON run_events(run_id, ts ASC, id ASC);
