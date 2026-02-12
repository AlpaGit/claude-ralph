import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { RunEvent, RunStatus, TaskRun, TodoItem } from "@shared/types";
import { nowIso } from "./shared-utils";
import { type RunEventRow, type RunRow, mapRunRow } from "./row-mappers";

// ---------------------------------------------------------------------------
// Input interfaces
// ---------------------------------------------------------------------------

export interface CreateRunInput {
  id: string;
  planId: string;
  taskId: string;
  status: RunStatus;
  retryCount?: number;
}

export interface UpdateRunInput {
  runId: string;
  status: RunStatus;
  sessionId?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  totalCostUsd?: number | null;
  resultText?: string | null;
  stopReason?: string | null;
  errorText?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Threshold (in milliseconds) for considering an in-progress run stale. */
const STALE_RUN_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Encapsulates all run-lifecycle persistence operations.
 *
 * Owns: runs, run_events, todo_snapshots.
 */
export class RunRepository {
  constructor(private readonly conn: BetterSqlite3.Database) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Insert a new run row with the given status and optional retry count.
   */
  createRun(input: CreateRunInput): void {
    this.conn
      .prepare(
        `
        INSERT INTO runs (
          id, plan_id, task_id, session_id, status, started_at, ended_at, duration_ms, total_cost_usd, result_text, stop_reason, error_text, retry_count
        ) VALUES (
          @id, @plan_id, @task_id, NULL, @status, @started_at, NULL, NULL, NULL, NULL, NULL, NULL, @retry_count
        );
      `,
      )
      .run({
        id: input.id,
        plan_id: input.planId,
        task_id: input.taskId,
        status: input.status,
        started_at: nowIso(),
        retry_count: input.retryCount ?? 0,
      });
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Update a run's status and optional metadata fields.
   * Uses COALESCE so that only provided (non-null) fields overwrite existing values.
   */
  updateRun(input: UpdateRunInput): void {
    this.conn
      .prepare(
        `
        UPDATE runs
        SET status = @status,
            session_id = COALESCE(@session_id, session_id),
            ended_at = COALESCE(@ended_at, ended_at),
            duration_ms = COALESCE(@duration_ms, duration_ms),
            total_cost_usd = COALESCE(@total_cost_usd, total_cost_usd),
            result_text = COALESCE(@result_text, result_text),
            stop_reason = COALESCE(@stop_reason, stop_reason),
            error_text = COALESCE(@error_text, error_text)
        WHERE id = @run_id;
      `,
      )
      .run({
        run_id: input.runId,
        status: input.status,
        session_id: input.sessionId ?? null,
        ended_at: input.endedAt ?? null,
        duration_ms: input.durationMs ?? null,
        total_cost_usd: input.totalCostUsd ?? null,
        result_text: input.resultText ?? null,
        stop_reason: input.stopReason ?? null,
        error_text: input.errorText ?? null,
      });
  }

  // ---------------------------------------------------------------------------
  // Read (single)
  // ---------------------------------------------------------------------------

  /**
   * Load a single run by ID.
   */
  getRun(runId: string): TaskRun | null {
    const row = this.conn.prepare("SELECT * FROM runs WHERE id = ? LIMIT 1;").get(runId) as
      | RunRow
      | undefined;
    if (!row) {
      return null;
    }

    return mapRunRow(row);
  }

  /**
   * Get the most recent failed run for a given task within a plan.
   * Used by the retry flow to extract previous error context.
   */
  getLatestFailedRun(planId: string, taskId: string): TaskRun | null {
    const row = this.conn
      .prepare(
        "SELECT * FROM runs WHERE plan_id = ? AND task_id = ? AND status = 'failed' ORDER BY started_at DESC LIMIT 1;",
      )
      .get(planId, taskId) as RunRow | undefined;

    if (!row) {
      return null;
    }

    return mapRunRow(row);
  }

  // ---------------------------------------------------------------------------
  // Read (list)
  // ---------------------------------------------------------------------------

  /**
   * Return all runs still marked as 'in_progress' whose started_at is older
   * than the given threshold (ISO timestamp).  Used to detect stale runs that
   * lost their in-memory ActiveRun tracking (e.g. after app restart).
   *
   * The default stale threshold is 1 hour ({@link STALE_RUN_THRESHOLD_MS}).
   */
  getStaleInProgressRuns(olderThan: string): TaskRun[] {
    const rows = this.conn
      .prepare(
        "SELECT * FROM runs WHERE status = 'in_progress' AND started_at < ? ORDER BY started_at ASC;",
      )
      .all(olderThan) as RunRow[];

    return rows.map(mapRunRow);
  }

  // ---------------------------------------------------------------------------
  // Run Events
  // ---------------------------------------------------------------------------

  /**
   * Append a single event to the run_events log.
   */
  appendRunEvent(event: RunEvent): void {
    this.conn
      .prepare(
        `
        INSERT INTO run_events (id, run_id, ts, level, event_type, payload_json)
        VALUES (@id, @run_id, @ts, @level, @event_type, @payload_json);
      `,
      )
      .run({
        id: event.id,
        run_id: event.runId,
        ts: event.ts,
        level: event.level,
        event_type: event.type,
        payload_json: JSON.stringify(event.payload ?? {}),
      });
  }

  /**
   * Retrieve run events for a given run with cursor-based pagination.
   * Returns up to `limit` events ordered by ts ASC.
   * When `afterId` is provided, only events after (ts > cursorTs OR (ts = cursorTs AND id > afterId))
   * are returned.  This relies on the composite index idx_run_events_run_ts_id.
   *
   * Uses the limit+1 pattern: fetches one extra row to determine `hasMore`
   * without a separate COUNT query.
   */
  getRunEvents(
    runId: string,
    options: { limit?: number; afterId?: string } = {},
  ): { events: RunEvent[]; hasMore: boolean } {
    const limit = options.limit ?? 100;

    let rows: RunEventRow[];

    if (options.afterId) {
      // Cursor-based: get the ts of the cursor event, then fetch events after it.
      // Use (ts, id) > (cursorTs, cursorId) for stable ordering when ts values collide.
      const cursorRow = this.conn
        .prepare("SELECT ts FROM run_events WHERE id = ? LIMIT 1;")
        .get(options.afterId) as { ts: string } | undefined;

      if (!cursorRow) {
        // Cursor event not found -- return from the beginning
        rows = this.conn
          .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY ts ASC, id ASC LIMIT ?;")
          .all(runId, limit + 1) as RunEventRow[];
      } else {
        rows = this.conn
          .prepare(
            `SELECT * FROM run_events
             WHERE run_id = ? AND (ts > ? OR (ts = ? AND id > ?))
             ORDER BY ts ASC, id ASC
             LIMIT ?;`,
          )
          .all(runId, cursorRow.ts, cursorRow.ts, options.afterId, limit + 1) as RunEventRow[];
      }
    } else {
      rows = this.conn
        .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY ts ASC, id ASC LIMIT ?;")
        .all(runId, limit + 1) as RunEventRow[];
    }

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    // Look up the parent run to populate planId and taskId on each event.
    const runRow = this.conn
      .prepare("SELECT plan_id, task_id FROM runs WHERE id = ? LIMIT 1;")
      .get(runId) as { plan_id: string; task_id: string } | undefined;
    const planId = runRow?.plan_id ?? "";
    const taskId = runRow?.task_id ?? "";

    const events: RunEvent[] = resultRows.map((row) => {
      let payload: unknown = {};
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        // keep empty object
      }

      return {
        id: row.id,
        ts: row.ts,
        runId: row.run_id,
        planId,
        taskId,
        type: row.event_type as RunEvent["type"],
        level: row.level,
        payload,
      };
    });

    return { events, hasMore };
  }

  // ---------------------------------------------------------------------------
  // Todo Snapshots
  // ---------------------------------------------------------------------------

  /**
   * Record a point-in-time snapshot of the todo list for a run.
   */
  addTodoSnapshot(runId: string, todos: TodoItem[]): void {
    const total = todos.length;
    const pending = todos.filter((todo) => todo.status === "pending").length;
    const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
    const completed = todos.filter((todo) => todo.status === "completed").length;

    this.conn
      .prepare(
        `
        INSERT INTO todo_snapshots (id, run_id, ts, total, pending, in_progress, completed, todos_json)
        VALUES (@id, @run_id, @ts, @total, @pending, @in_progress, @completed, @todos_json);
      `,
      )
      .run({
        id: randomUUID(),
        run_id: runId,
        ts: nowIso(),
        total,
        pending,
        in_progress: inProgress,
        completed,
        todos_json: JSON.stringify(todos),
      });
  }
}

export { STALE_RUN_THRESHOLD_MS };
