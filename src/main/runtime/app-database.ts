import { createHash, randomUUID } from "node:crypto";
import { normalize } from "node:path";
import Database from "better-sqlite3";
import type {
  AppSettings,
  DiscoveryAnswer,
  DiscoveryInterviewState,
  DiscoverySession,
  DiscoverySessionStatus,
  ListProjectMemoryInput,
  ListPlansFilter,
  PlanListItem,
  PlanStatus,
  ProjectMemoryItem,
  ProjectStackProfile as SharedProjectStackProfile,
  RalphPlan,
  RalphTask,
  RunEvent,
  RunStatus,
  TaskRun,
  TaskStatus,
  TechnicalPack,
  TodoItem,
  UpdateAppSettingsInput
} from "@shared/types";
import { MigrationRunner } from "./migrations/migration-runner";

/**
 * Custom error thrown when JSON columns in the database fail to parse.
 * Carries the plan/task context so callers can diagnose corrupt data.
 */
export class PlanParseError extends Error {
  constructor(
    public readonly field: string,
    public readonly entityId: string,
    public readonly cause: unknown
  ) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to parse ${field} for plan ${entityId}: ${causeMsg}`);
    this.name = "PlanParseError";
  }
}

/** Agent roles stored in the model_config table. */
export type AgentRole =
  | "discovery_specialist"
  | "plan_synthesis"
  | "task_execution"
  | "tester"
  | "architecture_specialist"
  | "committer";

export interface ModelConfigRow {
  id: string;
  agent_role: AgentRole;
  model_id: string;
  updated_at: string;
}

export interface ModelConfigEntry {
  id: string;
  agentRole: AgentRole;
  modelId: string;
  updatedAt: string;
}

interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

interface PlanRow {
  id: string;
  project_path: string;
  project_id: string | null;
  project_key: string | null;
  prd_text: string;
  summary: string;
  technical_pack_json: string;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface PlanListRow {
  id: string;
  summary: string;
  status: PlanStatus;
  project_path: string;
  project_id: string | null;
  project_key: string | null;
  created_at: string;
  archived_at: string | null;
}

interface TaskRow {
  id: string;
  plan_id: string;
  ordinal: number;
  title: string;
  description: string;
  dependencies_json: string;
  acceptance_criteria_json: string;
  technical_notes: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface RunRow {
  id: string;
  plan_id: string;
  task_id: string;
  session_id: string | null;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  total_cost_usd: number | null;
  result_text: string | null;
  stop_reason: string | null;
  error_text: string | null;
  retry_count: number;
}

interface RunEventRow {
  id: string;
  run_id: string;
  ts: string;
  level: "info" | "error";
  event_type: string;
  payload_json: string;
}

interface DiscoverySessionRow {
  id: string;
  project_path: string;
  project_id: string | null;
  project_key: string | null;
  seed_sentence: string;
  additional_context: string;
  answer_history_json: string;
  round_number: number;
  latest_state_json: string;
  status: DiscoverySessionStatus;
  created_at: string;
  updated_at: string;
}

interface CreateDiscoverySessionInput {
  id: string;
  projectPath: string;
  seedSentence: string;
  additionalContext: string;
  latestState: DiscoveryInterviewState;
}

interface UpdateDiscoverySessionInput {
  id: string;
  answerHistory?: DiscoveryAnswer[];
  roundNumber?: number;
  latestState?: DiscoveryInterviewState;
  status?: DiscoverySessionStatus;
}

interface CreatePlanTaskInput {
  id: string;
  ordinal: number;
  title: string;
  description: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  technicalNotes: string;
}

interface CreatePlanInput {
  id: string;
  projectPath: string;
  prdText: string;
  summary: string;
  technicalPack: TechnicalPack;
  tasks: CreatePlanTaskInput[];
}

export type ProjectStackProfile = SharedProjectStackProfile;

interface ProjectRow {
  id: string;
  project_key: string;
  canonical_path: string;
  display_name: string;
  metadata_json: string;
  stack_profile_json: string | null;
  created_at: string;
  updated_at: string;
  last_stack_refresh_at: string | null;
}

interface CreateRunInput {
  id: string;
  planId: string;
  taskId: string;
  status: RunStatus;
  retryCount?: number;
}

interface UpdateRunInput {
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

const nowIso = (): string => new Date().toISOString();

function normalizeProjectKey(projectPath: string): string {
  const trimmed = projectPath.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const normalized = normalize(trimmed).replace(/[\\/]+/g, "/").trim();
  if (normalized.length === 0) {
    return "";
  }

  return normalized.toLowerCase();
}

function buildStableProjectId(projectKey: string): string {
  const digest = createHash("sha1").update(projectKey).digest("hex");
  return `proj-${digest.slice(0, 24)}`;
}

function deriveProjectDisplayName(projectPath: string): string {
  const normalized = projectPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  if (normalized.length === 0) {
    return "Unnamed project";
  }

  const parts = normalized.split("/");
  const last = parts[parts.length - 1]?.trim();
  return last && last.length > 0 ? last : normalized;
}

/**
 * Parse a JSON string expected to contain a string array (e.g. dependencies, acceptance criteria).
 * On parse failure, logs a descriptive warning and throws a PlanParseError so the caller can
 * surface the problem rather than silently dropping data.
 *
 * @param value  - Raw JSON string from the database column.
 * @param field  - Column name (for error context).
 * @param entityId - The plan or task ID that owns the row (for error context).
 */
const parseJsonArray = (value: string | null | undefined, field: string, entityId: string): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch (error: unknown) {
    console.error(`[AppDatabase] Failed to parse ${field} for entity ${entityId}: ${error instanceof Error ? error.message : String(error)}`);
    throw new PlanParseError(field, entityId, error);
  }
};

export class AppDatabase {
  private readonly db: Database.Database;

  constructor(dbPath: string, migrationsDir: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    const runner = new MigrationRunner(this.db, migrationsDir);
    runner.run();
  }

  private parseProjectStackProfile(raw: string | null): ProjectStackProfile | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as ProjectStackProfile;
      if (
        parsed &&
        parsed.version === 1 &&
        parsed.specialistId === "stack-analyst" &&
        typeof parsed.updatedAt === "string" &&
        typeof parsed.stackSummary === "string" &&
        Array.isArray(parsed.stackHints) &&
        Array.isArray(parsed.signals) &&
        typeof parsed.confidence === "number"
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private parseProjectMetadata(raw: string): Record<string, unknown> {
    if (!raw || raw.trim().length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore parse errors and return empty metadata.
    }
    return {};
  }

  private mapPlanListRow(row: PlanListRow): PlanListItem {
    return {
      id: row.id,
      summary: row.summary,
      status: row.status,
      projectPath: row.project_path,
      createdAt: row.created_at,
      archivedAt: row.archived_at
    };
  }

  private mapProjectMemoryRow(row: ProjectRow, limitPlans: number): ProjectMemoryItem {
    const planRows = this.db
      .prepare(`
        SELECT id, summary, status, project_path, project_id, project_key, created_at, archived_at
        FROM plans
        WHERE project_id = @project_id
        ORDER BY created_at DESC
        LIMIT @limit;
      `)
      .all({
        project_id: row.id,
        limit: limitPlans
      }) as PlanListRow[];

    return {
      projectId: row.id,
      projectKey: row.project_key,
      projectPath: row.canonical_path,
      displayName: row.display_name,
      metadata: this.parseProjectMetadata(row.metadata_json),
      stackProfile: this.parseProjectStackProfile(row.stack_profile_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastStackRefreshAt: row.last_stack_refresh_at,
      recentPlans: planRows.map((planRow) => this.mapPlanListRow(planRow))
    };
  }

  private touchProject(projectPath: string): { projectId: string; projectKey: string; canonicalPath: string } | null {
    const projectKey = normalizeProjectKey(projectPath);
    if (projectKey.length === 0) {
      return null;
    }

    const canonicalPath = projectPath.trim().length > 0 ? projectPath.trim() : projectKey;
    const displayName = deriveProjectDisplayName(canonicalPath);
    const timestamp = nowIso();
    const stableProjectId = buildStableProjectId(projectKey);

    this.db
      .prepare(`
        INSERT INTO projects (
          id, project_key, canonical_path, display_name, metadata_json,
          stack_profile_json, created_at, updated_at, last_stack_refresh_at
        ) VALUES (
          @id, @project_key, @canonical_path, @display_name, '{}',
          NULL, @created_at, @updated_at, NULL
        )
        ON CONFLICT(project_key) DO UPDATE SET
          canonical_path = excluded.canonical_path,
          display_name = CASE
            WHEN projects.display_name IS NULL OR projects.display_name = '' THEN excluded.display_name
            ELSE projects.display_name
          END,
          updated_at = excluded.updated_at;
      `)
      .run({
        id: stableProjectId,
        project_key: projectKey,
        canonical_path: canonicalPath,
        display_name: displayName,
        created_at: timestamp,
        updated_at: timestamp
      });

    const row = this.db
      .prepare("SELECT id, project_key, canonical_path FROM projects WHERE project_key = ? LIMIT 1;")
      .get(projectKey) as { id: string; project_key: string; canonical_path: string } | undefined;

    if (!row) {
      return null;
    }

    this.db
      .prepare(`
        UPDATE plans
        SET project_id = @project_id
        WHERE project_key = @project_key
          AND (project_id IS NULL OR project_id = '');
      `)
      .run({
        project_id: row.id,
        project_key: projectKey
      });

    this.db
      .prepare(`
        UPDATE discovery_sessions
        SET project_id = @project_id
        WHERE project_key = @project_key
          AND (project_id IS NULL OR project_id = '');
      `)
      .run({
        project_id: row.id,
        project_key: projectKey
      });

    return {
      projectId: row.id,
      projectKey: row.project_key,
      canonicalPath: row.canonical_path
    };
  }

  getProjectStackProfile(projectPath: string): ProjectStackProfile | null {
    const project = this.touchProject(projectPath);
    if (!project) {
      return null;
    }

    const row = this.db
      .prepare("SELECT stack_profile_json FROM projects WHERE id = ? LIMIT 1;")
      .get(project.projectId) as Pick<ProjectRow, "stack_profile_json"> | undefined;

    return this.parseProjectStackProfile(row?.stack_profile_json ?? null);
  }

  upsertProjectStackProfile(projectPath: string, profile: ProjectStackProfile): void {
    const project = this.touchProject(projectPath);
    if (!project) {
      return;
    }

    this.db
      .prepare(`
        UPDATE projects
        SET stack_profile_json = @stack_profile_json,
            updated_at = @updated_at,
            last_stack_refresh_at = @last_stack_refresh_at
        WHERE id = @project_id;
      `)
      .run({
        project_id: project.projectId,
        stack_profile_json: JSON.stringify(profile),
        updated_at: nowIso(),
        last_stack_refresh_at: profile.updatedAt
      });
  }

  listPlansByProject(projectPath: string, limit = 10): PlanListItem[] {
    const project = this.touchProject(projectPath);
    if (!project) {
      return [];
    }

    const rows = this.db
      .prepare(`
        SELECT id, summary, status, project_path, project_id, project_key, created_at, archived_at
        FROM plans
        WHERE project_id = @project_id
        ORDER BY created_at DESC
        LIMIT @limit;
      `)
      .all({
        project_id: project.projectId,
        limit
      }) as PlanListRow[];

    return rows.map((row) => this.mapPlanListRow(row));
  }

  listProjectMemory(input: ListProjectMemoryInput = {}): ProjectMemoryItem[] {
    const limitPlans = Math.min(Math.max(input.limitPlans ?? 6, 1), 20);
    const search = input.search?.trim();
    const params: Record<string, unknown> = {};
    const filters: string[] = [];

    if (search && search.length > 0) {
      filters.push("(canonical_path LIKE @search OR display_name LIKE @search)");
      params.search = `%${search}%`;
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`
        SELECT id, project_key, canonical_path, display_name, metadata_json, stack_profile_json, created_at, updated_at, last_stack_refresh_at
        FROM projects
        ${where}
        ORDER BY updated_at DESC;
      `)
      .all(params) as ProjectRow[];

    return rows.map((row) => this.mapProjectMemoryRow(row, limitPlans));
  }

  getProjectMemoryItemById(projectId: string, limitPlans = 6): ProjectMemoryItem | null {
    const row = this.db
      .prepare(`
        SELECT id, project_key, canonical_path, display_name, metadata_json, stack_profile_json, created_at, updated_at, last_stack_refresh_at
        FROM projects
        WHERE id = ?
        LIMIT 1;
      `)
      .get(projectId) as ProjectRow | undefined;

    if (!row) {
      return null;
    }

    return this.mapProjectMemoryRow(row, Math.min(Math.max(limitPlans, 1), 20));
  }

  createPlan(input: CreatePlanInput): void {
    const createdAt = nowIso();
    const project = this.touchProject(input.projectPath);

    const insertPlan = this.db.prepare(`
      INSERT INTO plans (
        id, project_path, project_id, project_key, prd_text, summary, technical_pack_json, status, created_at, updated_at
      ) VALUES (
        @id, @project_path, @project_id, @project_key, @prd_text, @summary, @technical_pack_json, @status, @created_at, @updated_at
      );
    `);

    const insertTask = this.db.prepare(`
      INSERT INTO tasks (
        id, plan_id, ordinal, title, description, dependencies_json, acceptance_criteria_json, technical_notes, status, created_at, updated_at, completed_at
      ) VALUES (
        @id, @plan_id, @ordinal, @title, @description, @dependencies_json, @acceptance_criteria_json, @technical_notes, @status, @created_at, @updated_at, NULL
      );
    `);

    const transaction = this.db.transaction(() => {
      insertPlan.run({
        id: input.id,
        project_path: input.projectPath,
        project_id: project?.projectId ?? null,
        project_key: project?.projectKey ?? null,
        prd_text: input.prdText,
        summary: input.summary,
        technical_pack_json: JSON.stringify(input.technicalPack),
        status: "ready",
        created_at: createdAt,
        updated_at: createdAt
      });

      for (const task of input.tasks) {
        insertTask.run({
          id: task.id,
          plan_id: input.id,
          ordinal: task.ordinal,
          title: task.title,
          description: task.description,
          dependencies_json: JSON.stringify(task.dependencies),
          acceptance_criteria_json: JSON.stringify(task.acceptanceCriteria),
          technical_notes: task.technicalNotes,
          status: "pending",
          created_at: createdAt,
          updated_at: createdAt
        });
      }
    });

    transaction();
  }

  getPlan(planId: string): RalphPlan | null {
    const planRow = this.db.prepare("SELECT * FROM plans WHERE id = ?;").get(planId) as PlanRow | undefined;
    if (!planRow) {
      return null;
    }

    const taskRows = this.db
      .prepare("SELECT * FROM tasks WHERE plan_id = ? ORDER BY ordinal ASC;")
      .all(planId) as TaskRow[];

    const runRows = this.db
      .prepare("SELECT * FROM runs WHERE plan_id = ? ORDER BY started_at DESC;")
      .all(planId) as RunRow[];

    let technicalPack: TechnicalPack;
    try {
      technicalPack = JSON.parse(planRow.technical_pack_json) as TechnicalPack;
    } catch (error: unknown) {
      console.error(`[AppDatabase] Failed to parse technical_pack_json for plan ${planId}: ${error instanceof Error ? error.message : String(error)}`);
      throw new PlanParseError("technical_pack_json", planId, error);
    }

    const tasks: RalphTask[] = taskRows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      ordinal: row.ordinal,
      title: row.title,
      description: row.description,
      dependencies: parseJsonArray(row.dependencies_json, "dependencies_json", row.id),
      acceptanceCriteria: parseJsonArray(row.acceptance_criteria_json, "acceptance_criteria_json", row.id),
      technicalNotes: row.technical_notes,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at
    }));

    const runs: TaskRun[] = runRows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      taskId: row.task_id,
      sessionId: row.session_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs: row.duration_ms,
      totalCostUsd: row.total_cost_usd,
      resultText: row.result_text,
      stopReason: row.stop_reason,
      errorText: row.error_text,
      retryCount: row.retry_count ?? 0
    }));

    return {
      id: planRow.id,
      projectPath: planRow.project_path,
      prdText: planRow.prd_text,
      summary: planRow.summary,
      technicalPack,
      status: planRow.status,
      createdAt: planRow.created_at,
      updatedAt: planRow.updated_at,
      archivedAt: planRow.archived_at,
      tasks,
      runs
    };
  }

  getTask(planId: string, taskId: string): RalphTask | null {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE plan_id = ? AND id = ? LIMIT 1;")
      .get(planId, taskId) as TaskRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      planId: row.plan_id,
      ordinal: row.ordinal,
      title: row.title,
      description: row.description,
      dependencies: parseJsonArray(row.dependencies_json, "dependencies_json", row.id),
      acceptanceCriteria: parseJsonArray(row.acceptance_criteria_json, "acceptance_criteria_json", row.id),
      technicalNotes: row.technical_notes,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at
    };
  }

  getTasks(planId: string): RalphTask[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE plan_id = ? ORDER BY ordinal ASC;")
      .all(planId) as TaskRow[];

    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      ordinal: row.ordinal,
      title: row.title,
      description: row.description,
      dependencies: parseJsonArray(row.dependencies_json, "dependencies_json", row.id),
      acceptanceCriteria: parseJsonArray(row.acceptance_criteria_json, "acceptance_criteria_json", row.id),
      technicalNotes: row.technical_notes,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at
    }));
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const timestamp = nowIso();

    this.db
      .prepare(`
        UPDATE tasks
        SET status = @status,
            updated_at = @updated_at,
            completed_at = CASE
              WHEN @status = 'completed' THEN @updated_at
              ELSE completed_at
            END
        WHERE id = @id;
      `)
      .run({
        id: taskId,
        status,
        updated_at: timestamp
      });
  }

  updatePlanStatus(planId: string, status: PlanStatus): void {
    this.db
      .prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?;")
      .run(status, nowIso(), planId);
  }

  createRun(input: CreateRunInput): void {
    this.db
      .prepare(`
        INSERT INTO runs (
          id, plan_id, task_id, session_id, status, started_at, ended_at, duration_ms, total_cost_usd, result_text, stop_reason, error_text, retry_count
        ) VALUES (
          @id, @plan_id, @task_id, NULL, @status, @started_at, NULL, NULL, NULL, NULL, NULL, NULL, @retry_count
        );
      `)
      .run({
        id: input.id,
        plan_id: input.planId,
        task_id: input.taskId,
        status: input.status,
        started_at: nowIso(),
        retry_count: input.retryCount ?? 0
      });
  }

  updateRun(input: UpdateRunInput): void {
    this.db
      .prepare(`
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
      `)
      .run({
        run_id: input.runId,
        status: input.status,
        session_id: input.sessionId ?? null,
        ended_at: input.endedAt ?? null,
        duration_ms: input.durationMs ?? null,
        total_cost_usd: input.totalCostUsd ?? null,
        result_text: input.resultText ?? null,
        stop_reason: input.stopReason ?? null,
        error_text: input.errorText ?? null
      });
  }

  getRun(runId: string): TaskRun | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ? LIMIT 1;").get(runId) as RunRow | undefined;
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      planId: row.plan_id,
      taskId: row.task_id,
      sessionId: row.session_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs: row.duration_ms,
      totalCostUsd: row.total_cost_usd,
      resultText: row.result_text,
      stopReason: row.stop_reason,
      errorText: row.error_text,
      retryCount: row.retry_count ?? 0
    };
  }

  appendRunEvent(event: RunEvent): void {
    this.db
      .prepare(`
        INSERT INTO run_events (id, run_id, ts, level, event_type, payload_json)
        VALUES (@id, @run_id, @ts, @level, @event_type, @payload_json);
      `)
      .run({
        id: event.id,
        run_id: event.runId,
        ts: event.ts,
        level: event.level,
        event_type: event.type,
        payload_json: JSON.stringify(event.payload ?? {})
      });
  }

  /**
   * Retrieve run events for a given run with cursor-based pagination.
   * Returns up to `limit` events ordered by ts ASC.
   * When `afterId` is provided, only events with id > afterId (by ts ordering) are returned.
   */
  getRunEvents(
    runId: string,
    options: { limit?: number; afterId?: string } = {}
  ): { events: RunEvent[]; hasMore: boolean } {
    const limit = options.limit ?? 100;

    let rows: RunEventRow[];

    if (options.afterId) {
      // Cursor-based: get the ts of the cursor event, then fetch events after it.
      // Use (ts, id) > (cursorTs, cursorId) for stable ordering when ts values collide.
      const cursorRow = this.db
        .prepare("SELECT ts FROM run_events WHERE id = ? LIMIT 1;")
        .get(options.afterId) as { ts: string } | undefined;

      if (!cursorRow) {
        // Cursor event not found -- return from the beginning
        rows = this.db
          .prepare(
            "SELECT * FROM run_events WHERE run_id = ? ORDER BY ts ASC, id ASC LIMIT ?;"
          )
          .all(runId, limit + 1) as RunEventRow[];
      } else {
        rows = this.db
          .prepare(
            `SELECT * FROM run_events
             WHERE run_id = ? AND (ts > ? OR (ts = ? AND id > ?))
             ORDER BY ts ASC, id ASC
             LIMIT ?;`
          )
          .all(runId, cursorRow.ts, cursorRow.ts, options.afterId, limit + 1) as RunEventRow[];
      }
    } else {
      rows = this.db
        .prepare(
          "SELECT * FROM run_events WHERE run_id = ? ORDER BY ts ASC, id ASC LIMIT ?;"
        )
        .all(runId, limit + 1) as RunEventRow[];
    }

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    // Look up the parent run to populate planId and taskId on each event.
    const runRow = this.db
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
        payload
      };
    });

    return { events, hasMore };
  }

  addTodoSnapshot(runId: string, todos: TodoItem[]): void {
    const total = todos.length;
    const pending = todos.filter((todo) => todo.status === "pending").length;
    const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
    const completed = todos.filter((todo) => todo.status === "completed").length;

    this.db
      .prepare(`
        INSERT INTO todo_snapshots (id, run_id, ts, total, pending, in_progress, completed, todos_json)
        VALUES (@id, @run_id, @ts, @total, @pending, @in_progress, @completed, @todos_json);
      `)
      .run({
        id: randomUUID(),
        run_id: runId,
        ts: nowIso(),
        total,
        pending,
        in_progress: inProgress,
        completed,
        todos_json: JSON.stringify(todos)
      });
  }

  countRunnableTasks(planId: string): number {
    const tasks = this.getTasks(planId);
    const statusById = new Map(tasks.map((task) => [task.id, task.status]));

    return tasks.filter((task) => {
      if (task.status !== "pending") {
        return false;
      }

      return task.dependencies.every((dependencyId) => {
        const depStatus = statusById.get(dependencyId);
        return depStatus === "completed" || depStatus === "skipped";
      });
    }).length;
  }

  findNextRunnableTask(planId: string): RalphTask | null {
    const tasks = this.getTasks(planId);
    const statusById = new Map(tasks.map((task) => [task.id, task.status]));

    for (const task of tasks) {
      if (task.status !== "pending") {
        continue;
      }

      const hasOpenDependencies = task.dependencies.some((dependencyId) => {
        const depStatus = statusById.get(dependencyId);
        return depStatus !== "completed" && depStatus !== "skipped";
      });

      if (!hasOpenDependencies) {
        return task;
      }
    }

    return null;
  }

  /**
   * Get the most recent failed run for a given task within a plan.
   * Used by the retry flow to extract previous error context.
   */
  getLatestFailedRun(planId: string, taskId: string): TaskRun | null {
    const row = this.db
      .prepare(
        "SELECT * FROM runs WHERE plan_id = ? AND task_id = ? AND status = 'failed' ORDER BY started_at DESC LIMIT 1;"
      )
      .get(planId, taskId) as RunRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      planId: row.plan_id,
      taskId: row.task_id,
      sessionId: row.session_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs: row.duration_ms,
      totalCostUsd: row.total_cost_usd,
      resultText: row.result_text,
      stopReason: row.stop_reason,
      errorText: row.error_text,
      retryCount: row.retry_count ?? 0
    };
  }

  /**
   * List plans with optional filtering by archive status and search text.
   * Returns minimal plan records (no tasks, runs, or PRD body).
   */
  listPlans(filter?: ListPlansFilter): PlanListItem[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.archived === true) {
      conditions.push("archived_at IS NOT NULL");
    } else if (filter?.archived === false) {
      conditions.push("archived_at IS NULL");
    }

    if (filter?.search) {
      conditions.push("(summary LIKE @search OR project_path LIKE @search)");
      params.search = `%${filter.search}%`;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT id, summary, status, project_path, project_id, project_key, created_at, archived_at FROM plans ${where} ORDER BY created_at DESC;`;

    const rows = this.db.prepare(sql).all(params) as PlanListRow[];

    return rows.map((row) => ({
      id: row.id,
      summary: row.summary,
      status: row.status,
      projectPath: row.project_path,
      createdAt: row.created_at,
      archivedAt: row.archived_at
    }));
  }

  /**
   * Permanently delete a plan and all its associated tasks, runs, run_events,
   * and todo_snapshots. Relies on ON DELETE CASCADE defined on foreign keys.
   */
  deletePlan(planId: string): void {
    this.db.prepare("DELETE FROM plans WHERE id = ?;").run(planId);
  }

  /**
   * Soft-archive a plan by setting archived_at to the current ISO timestamp.
   */
  archivePlan(planId: string): void {
    this.db
      .prepare("UPDATE plans SET archived_at = ?, updated_at = ? WHERE id = ?;")
      .run(nowIso(), nowIso(), planId);
  }

  /**
   * Remove the archived status from a plan by clearing archived_at.
   */
  unarchivePlan(planId: string): void {
    this.db
      .prepare("UPDATE plans SET archived_at = NULL, updated_at = ? WHERE id = ?;")
      .run(nowIso(), planId);
  }

  /**
   * Return all model configuration rows (one per agent role).
   */
  getModelConfig(): ModelConfigEntry[] {
    const rows = this.db
      .prepare("SELECT id, agent_role, model_id, updated_at FROM model_config ORDER BY agent_role ASC;")
      .all() as ModelConfigRow[];

    return rows.map((row) => ({
      id: row.id,
      agentRole: row.agent_role,
      modelId: row.model_id,
      updatedAt: row.updated_at
    }));
  }

  /**
   * Update the model ID for a specific agent role.
   * Throws if the role does not exist in the model_config table.
   */
  updateModelForRole(role: AgentRole, modelId: string): void {
    const result = this.db
      .prepare("UPDATE model_config SET model_id = ?, updated_at = ? WHERE agent_role = ?;")
      .run(modelId, nowIso(), role);

    if (result.changes === 0) {
      throw new Error(`Unknown agent role: ${role}`);
    }
  }

  /**
   * Return persisted application settings.
   */
  getAppSettings(): AppSettings {
    const row = this.db
      .prepare("SELECT key, value, updated_at FROM app_settings WHERE key = 'discord_webhook_url' LIMIT 1;")
      .get() as AppSettingRow | undefined;

    return {
      discordWebhookUrl: row?.value ?? ""
    };
  }

  /**
   * Update persisted application settings.
   */
  updateAppSettings(input: UpdateAppSettingsInput): void {
    this.db
      .prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('discord_webhook_url', @value, @updated_at)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at;
      `)
      .run({
        value: input.discordWebhookUrl,
        updated_at: nowIso()
      });
  }

  // ---------------------------------------------------------------------------
  // Discovery Sessions
  // ---------------------------------------------------------------------------

  /**
   * Create a new discovery session.
   * answer_history_json starts as an empty array; round_number defaults to 1.
   */
  createDiscoverySession(input: CreateDiscoverySessionInput): DiscoverySession {
    const now = nowIso();
    const project = this.touchProject(input.projectPath);

    this.db
      .prepare(`
        INSERT INTO discovery_sessions (
          id, project_path, project_id, project_key, seed_sentence, additional_context,
          answer_history_json, round_number, latest_state_json,
          status, created_at, updated_at
        ) VALUES (
          @id, @project_path, @project_id, @project_key, @seed_sentence, @additional_context,
          @answer_history_json, @round_number, @latest_state_json,
          @status, @created_at, @updated_at
        );
      `)
      .run({
        id: input.id,
        project_path: input.projectPath,
        project_id: project?.projectId ?? null,
        project_key: project?.projectKey ?? null,
        seed_sentence: input.seedSentence,
        additional_context: input.additionalContext,
        answer_history_json: "[]",
        round_number: 1,
        latest_state_json: JSON.stringify(input.latestState),
        status: "active",
        created_at: now,
        updated_at: now
      });

    return {
      id: input.id,
      projectPath: input.projectPath,
      seedSentence: input.seedSentence,
      additionalContext: input.additionalContext,
      answerHistory: [],
      roundNumber: 1,
      latestState: input.latestState,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Update an existing discovery session.
   * Only the provided fields are updated; others are left unchanged.
   */
  updateDiscoverySession(input: UpdateDiscoverySessionInput): void {
    const sets: string[] = ["updated_at = @updated_at"];
    const params: Record<string, unknown> = {
      id: input.id,
      updated_at: nowIso()
    };

    if (input.answerHistory !== undefined) {
      sets.push("answer_history_json = @answer_history_json");
      params.answer_history_json = JSON.stringify(input.answerHistory);
    }

    if (input.roundNumber !== undefined) {
      sets.push("round_number = @round_number");
      params.round_number = input.roundNumber;
    }

    if (input.latestState !== undefined) {
      sets.push("latest_state_json = @latest_state_json");
      params.latest_state_json = JSON.stringify(input.latestState);
    }

    if (input.status !== undefined) {
      sets.push("status = @status");
      params.status = input.status;
    }

    const sql = `UPDATE discovery_sessions SET ${sets.join(", ")} WHERE id = @id;`;
    this.db.prepare(sql).run(params);
  }

  /**
   * Return all discovery sessions with status 'active', ordered by most recently updated first.
   */
  getActiveDiscoverySessions(): DiscoverySession[] {
    const rows = this.db
      .prepare("SELECT * FROM discovery_sessions WHERE status = 'active' ORDER BY updated_at DESC;")
      .all() as DiscoverySessionRow[];

    return rows.map((row) => this.mapDiscoverySessionRow(row));
  }

  /**
   * Return a single discovery session by ID, or null if not found.
   */
  getDiscoverySession(id: string): DiscoverySession | null {
    const row = this.db
      .prepare("SELECT * FROM discovery_sessions WHERE id = ? LIMIT 1;")
      .get(id) as DiscoverySessionRow | undefined;

    if (!row) {
      return null;
    }

    return this.mapDiscoverySessionRow(row);
  }

  /**
   * Mark a discovery session as abandoned.
   */
  abandonDiscoverySession(id: string): void {
    this.db
      .prepare("UPDATE discovery_sessions SET status = 'abandoned', updated_at = ? WHERE id = ?;")
      .run(nowIso(), id);
  }

  /**
   * Map a raw DiscoverySessionRow to the application-level DiscoverySession type.
   */
  private mapDiscoverySessionRow(row: DiscoverySessionRow): DiscoverySession {
    let answerHistory: DiscoveryAnswer[];
    try {
      const parsed = JSON.parse(row.answer_history_json);
      answerHistory = Array.isArray(parsed) ? parsed : [];
    } catch {
      console.error(`[AppDatabase] Failed to parse answer_history_json for discovery session ${row.id}`);
      answerHistory = [];
    }

    let latestState: DiscoveryInterviewState;
    try {
      latestState = JSON.parse(row.latest_state_json) as DiscoveryInterviewState;
    } catch (error: unknown) {
      console.error(`[AppDatabase] Failed to parse latest_state_json for discovery session ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw new PlanParseError("latest_state_json", row.id, error);
    }

    return {
      id: row.id,
      projectPath: row.project_path,
      seedSentence: row.seed_sentence,
      additionalContext: row.additional_context,
      answerHistory,
      roundNumber: row.round_number,
      latestState,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Return all runs still marked as 'in_progress' whose started_at is older
   * than the given threshold (ISO timestamp).  Used to detect stale runs that
   * lost their in-memory ActiveRun tracking (e.g. after app restart).
   */
  getStaleInProgressRuns(olderThan: string): TaskRun[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM runs WHERE status = 'in_progress' AND started_at < ? ORDER BY started_at ASC;"
      )
      .all(olderThan) as RunRow[];

    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      taskId: row.task_id,
      sessionId: row.session_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs: row.duration_ms,
      totalCostUsd: row.total_cost_usd,
      resultText: row.result_text,
      stopReason: row.stop_reason,
      errorText: row.error_text,
      retryCount: row.retry_count ?? 0
    }));
  }

  close(): void {
    this.db.close();
  }
}
