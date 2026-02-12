import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
  ListPlansFilter,
  PlanListItem,
  PlanStatus,
  RalphPlan,
  RalphTask,
  RunEvent,
  RunStatus,
  TaskRun,
  TaskStatus,
  TechnicalPack,
  TodoItem
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
export type AgentRole = "discovery_specialist" | "plan_synthesis" | "task_execution";

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

interface PlanRow {
  id: string;
  project_path: string;
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

interface CreateRunInput {
  id: string;
  planId: string;
  taskId: string;
  status: RunStatus;
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

  createPlan(input: CreatePlanInput): void {
    const createdAt = nowIso();

    const insertPlan = this.db.prepare(`
      INSERT INTO plans (
        id, project_path, prd_text, summary, technical_pack_json, status, created_at, updated_at
      ) VALUES (
        @id, @project_path, @prd_text, @summary, @technical_pack_json, @status, @created_at, @updated_at
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
      errorText: row.error_text
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
          id, plan_id, task_id, session_id, status, started_at, ended_at, duration_ms, total_cost_usd, result_text, stop_reason, error_text
        ) VALUES (
          @id, @plan_id, @task_id, NULL, @status, @started_at, NULL, NULL, NULL, NULL, NULL, NULL
        );
      `)
      .run({
        id: input.id,
        plan_id: input.planId,
        task_id: input.taskId,
        status: input.status,
        started_at: nowIso()
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
      errorText: row.error_text
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

      return task.dependencies.every((dependencyId) => statusById.get(dependencyId) === "completed");
    }).length;
  }

  findNextRunnableTask(planId: string): RalphTask | null {
    const tasks = this.getTasks(planId);
    const statusById = new Map(tasks.map((task) => [task.id, task.status]));

    for (const task of tasks) {
      if (task.status !== "pending") {
        continue;
      }

      const hasOpenDependencies = task.dependencies.some(
        (dependencyId) => statusById.get(dependencyId) !== "completed"
      );

      if (!hasOpenDependencies) {
        return task;
      }
    }

    return null;
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
    const sql = `SELECT id, summary, status, project_path, created_at, archived_at FROM plans ${where} ORDER BY created_at DESC;`;

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

  close(): void {
    this.db.close();
  }
}

