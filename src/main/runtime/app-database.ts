import { createHash } from "node:crypto";
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
  TaskFollowupProposal,
  TaskFollowupProposalStatus,
  TaskRun,
  TaskStatus,
  TechnicalPack,
  TodoItem,
  UpdateAppSettingsInput,
} from "@shared/types";
import { MigrationRunner } from "./migrations/migration-runner";
import { PlanRepository } from "./repositories/plan-repository";
import { RunRepository } from "./repositories/run-repository";
import type { CreateRunInput, UpdateRunInput } from "./repositories/run-repository";
import { TaskRepository } from "./repositories/task-repository";
import {
  type CreatePlanInput,
  type PlanListRow,
  mapPlanListRow,
} from "./repositories/row-mappers";

/**
 * Custom error thrown when JSON columns in the database fail to parse.
 * Carries the plan/task context so callers can diagnose corrupt data.
 */
export class PlanParseError extends Error {
  constructor(
    public readonly field: string,
    public readonly entityId: string,
    public readonly cause: unknown,
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

const APP_SETTING_DISCORD_WEBHOOK_URL = "discord_webhook_url";
const APP_SETTING_QUEUE_PARALLEL_ENABLED = "queue_parallel_enabled";

// PlanRow, PlanListRow, TaskRow, RunRow, and RunEventRow are now defined in ./repositories/row-mappers.ts
// PlanProgressEntryRow and TaskFollowupProposalRow are now defined in ./repositories/row-mappers.ts
// CreateRunInput and UpdateRunInput are now defined in ./repositories/run-repository.ts

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

const nowIso = (): string => new Date().toISOString();

function normalizeProjectKey(projectPath: string): string {
  const trimmed = projectPath.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const normalized = normalize(trimmed)
    .replace(/[\\/]+/g, "/")
    .trim();
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
const parseJsonArray = (
  value: string | null | undefined,
  field: string,
  entityId: string,
): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch (error: unknown) {
    console.error(
      `[AppDatabase] Failed to parse ${field} for entity ${entityId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new PlanParseError(field, entityId, error);
  }
};

export class AppDatabase {
  private readonly db: Database.Database;
  private readonly planRepo: PlanRepository;
  private readonly taskRepo: TaskRepository;
  private readonly runRepo: RunRepository;

  constructor(dbPath: string, migrationsDir: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    const runner = new MigrationRunner(this.db, migrationsDir);
    runner.run();

    // Bind touchProject so repositories can resolve project identity
    // without owning the projects table directly.
    const touchProjectBound = this.touchProject.bind(this);
    this.planRepo = new PlanRepository(this.db, touchProjectBound);
    this.taskRepo = new TaskRepository(this.db);
    this.runRepo = new RunRepository(this.db);
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

  // mapPlanListRow and mapTaskFollowupProposalRow are now standalone functions
  // imported from ./repositories/row-mappers.ts

  private mapProjectMemoryRow(row: ProjectRow, limitPlans: number): ProjectMemoryItem {
    const planRows = this.db
      .prepare(
        `
        SELECT id, summary, status, project_path, project_id, project_key, created_at, archived_at
        FROM plans
        WHERE project_id = @project_id
        ORDER BY created_at DESC
        LIMIT @limit;
      `,
      )
      .all({
        project_id: row.id,
        limit: limitPlans,
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
      recentPlans: planRows.map(mapPlanListRow),
    };
  }

  private touchProject(
    projectPath: string,
  ): { projectId: string; projectKey: string; canonicalPath: string } | null {
    const projectKey = normalizeProjectKey(projectPath);
    if (projectKey.length === 0) {
      return null;
    }

    const canonicalPath = projectPath.trim().length > 0 ? projectPath.trim() : projectKey;
    const displayName = deriveProjectDisplayName(canonicalPath);
    const timestamp = nowIso();
    const stableProjectId = buildStableProjectId(projectKey);

    this.db
      .prepare(
        `
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
      `,
      )
      .run({
        id: stableProjectId,
        project_key: projectKey,
        canonical_path: canonicalPath,
        display_name: displayName,
        created_at: timestamp,
        updated_at: timestamp,
      });

    const row = this.db
      .prepare(
        "SELECT id, project_key, canonical_path FROM projects WHERE project_key = ? LIMIT 1;",
      )
      .get(projectKey) as { id: string; project_key: string; canonical_path: string } | undefined;

    if (!row) {
      return null;
    }

    this.db
      .prepare(
        `
        UPDATE plans
        SET project_id = @project_id
        WHERE project_key = @project_key
          AND (project_id IS NULL OR project_id = '');
      `,
      )
      .run({
        project_id: row.id,
        project_key: projectKey,
      });

    this.db
      .prepare(
        `
        UPDATE discovery_sessions
        SET project_id = @project_id
        WHERE project_key = @project_key
          AND (project_id IS NULL OR project_id = '');
      `,
      )
      .run({
        project_id: row.id,
        project_key: projectKey,
      });

    return {
      projectId: row.id,
      projectKey: row.project_key,
      canonicalPath: row.canonical_path,
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
      .prepare(
        `
        UPDATE projects
        SET stack_profile_json = @stack_profile_json,
            updated_at = @updated_at,
            last_stack_refresh_at = @last_stack_refresh_at
        WHERE id = @project_id;
      `,
      )
      .run({
        project_id: project.projectId,
        stack_profile_json: JSON.stringify(profile),
        updated_at: nowIso(),
        last_stack_refresh_at: profile.updatedAt,
      });
  }

  listPlansByProject(projectPath: string, limit = 10): PlanListItem[] {
    return this.planRepo.listPlansByProject(projectPath, limit);
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
      .prepare(
        `
        SELECT id, project_key, canonical_path, display_name, metadata_json, stack_profile_json, created_at, updated_at, last_stack_refresh_at
        FROM projects
        ${where}
        ORDER BY updated_at DESC;
      `,
      )
      .all(params) as ProjectRow[];

    return rows.map((row) => this.mapProjectMemoryRow(row, limitPlans));
  }

  getProjectMemoryItemById(projectId: string, limitPlans = 6): ProjectMemoryItem | null {
    const row = this.db
      .prepare(
        `
        SELECT id, project_key, canonical_path, display_name, metadata_json, stack_profile_json, created_at, updated_at, last_stack_refresh_at
        FROM projects
        WHERE id = ?
        LIMIT 1;
      `,
      )
      .get(projectId) as ProjectRow | undefined;

    if (!row) {
      return null;
    }

    return this.mapProjectMemoryRow(row, Math.min(Math.max(limitPlans, 1), 20));
  }

  createPlan(input: CreatePlanInput): void {
    this.planRepo.createPlan(input);
  }

  getPlan(planId: string): RalphPlan | null {
    return this.planRepo.getPlan(planId);
  }

  getTask(planId: string, taskId: string): RalphTask | null {
    return this.taskRepo.getTask(planId, taskId);
  }

  getTasks(planId: string): RalphTask[] {
    return this.taskRepo.getTasks(planId);
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    this.taskRepo.updateTaskStatus(taskId, status);
  }

  updatePlanStatus(planId: string, status: PlanStatus): void {
    this.planRepo.updatePlanStatus(planId, status);
  }

  createRun(input: CreateRunInput): void {
    this.runRepo.createRun(input);
  }

  updateRun(input: UpdateRunInput): void {
    this.runRepo.updateRun(input);
  }

  getRun(runId: string): TaskRun | null {
    return this.runRepo.getRun(runId);
  }

  appendRunEvent(event: RunEvent): void {
    this.runRepo.appendRunEvent(event);
  }

  getRunEvents(
    runId: string,
    options: { limit?: number; afterId?: string } = {},
  ): { events: RunEvent[]; hasMore: boolean } {
    return this.runRepo.getRunEvents(runId, options);
  }

  addTodoSnapshot(runId: string, todos: TodoItem[]): void {
    this.runRepo.addTodoSnapshot(runId, todos);
  }

  appendPlanProgressEntry(input: {
    planId: string;
    runId?: string | null;
    status: "completed" | "failed" | "cancelled";
    entryText: string;
  }): void {
    this.planRepo.appendPlanProgressEntry(input);
  }

  listPlanProgressEntries(
    planId: string,
    limit = 12,
  ): {
    id: string;
    planId: string;
    runId: string | null;
    status: "completed" | "failed" | "cancelled";
    entryText: string;
    createdAt: string;
  }[] {
    return this.planRepo.listPlanProgressEntries(planId, limit);
  }

  createTaskFollowupProposal(input: {
    planId: string;
    sourceRunId?: string | null;
    sourceTaskId: string;
    findingKey: string;
    title: string;
    description: string;
    severity: string;
    rule: string;
    location: string;
    message: string;
    recommendedAction: string;
    acceptanceCriteria: string[];
    technicalNotes: string;
  }): boolean {
    return this.taskRepo.createTaskFollowupProposal(input);
  }

  listTaskFollowupProposals(
    planId: string,
    statuses?: TaskFollowupProposalStatus[],
  ): TaskFollowupProposal[] {
    return this.taskRepo.listTaskFollowupProposals(planId, statuses);
  }

  approveTaskFollowupProposal(input: {
    planId: string;
    proposalId: string;
  }): { taskId: string } | null {
    return this.taskRepo.approveTaskFollowupProposal(input);
  }

  dismissTaskFollowupProposal(input: { planId: string; proposalId: string }): boolean {
    return this.taskRepo.dismissTaskFollowupProposal(input);
  }

  countRunnableTasks(planId: string): number {
    return this.taskRepo.countRunnableTasks(planId);
  }

  findNextRunnableTask(planId: string): RalphTask | null {
    return this.taskRepo.findNextRunnableTask(planId);
  }

  /**
   * Get the most recent failed run for a given task within a plan.
   * Used by the retry flow to extract previous error context.
   */
  getLatestFailedRun(planId: string, taskId: string): TaskRun | null {
    return this.runRepo.getLatestFailedRun(planId, taskId);
  }

  /**
   * List plans with optional filtering by archive status and search text.
   * Returns minimal plan records (no tasks, runs, or PRD body).
   */
  listPlans(filter?: ListPlansFilter): PlanListItem[] {
    return this.planRepo.listPlans(filter);
  }

  /**
   * Permanently delete a plan and all its associated tasks, runs, run_events,
   * and todo_snapshots. Relies on ON DELETE CASCADE defined on foreign keys.
   */
  deletePlan(planId: string): void {
    this.planRepo.deletePlan(planId);
  }

  /**
   * Soft-archive a plan by setting archived_at to the current ISO timestamp.
   */
  archivePlan(planId: string): void {
    this.planRepo.archivePlan(planId);
  }

  /**
   * Remove the archived status from a plan by clearing archived_at.
   */
  unarchivePlan(planId: string): void {
    this.planRepo.unarchivePlan(planId);
  }

  /**
   * Return all model configuration rows (one per agent role).
   */
  getModelConfig(): ModelConfigEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, agent_role, model_id, updated_at FROM model_config ORDER BY agent_role ASC;",
      )
      .all() as ModelConfigRow[];

    return rows.map((row) => ({
      id: row.id,
      agentRole: row.agent_role,
      modelId: row.model_id,
      updatedAt: row.updated_at,
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
    const rows = this.db
      .prepare(
        `
        SELECT key, value, updated_at
        FROM app_settings
        WHERE key IN (@webhook_key, @queue_parallel_key);
      `,
      )
      .all({
        webhook_key: APP_SETTING_DISCORD_WEBHOOK_URL,
        queue_parallel_key: APP_SETTING_QUEUE_PARALLEL_ENABLED,
      }) as AppSettingRow[];

    const settingsMap = new Map(rows.map((row) => [row.key, row.value]));
    const queueParallelRaw = settingsMap.get(APP_SETTING_QUEUE_PARALLEL_ENABLED) ?? "1";
    const queueParallelEnabled =
      queueParallelRaw === "1" || queueParallelRaw.toLowerCase() === "true";

    return {
      discordWebhookUrl: settingsMap.get(APP_SETTING_DISCORD_WEBHOOK_URL) ?? "",
      queueParallelEnabled,
    };
  }

  /**
   * Update persisted application settings.
   */
  updateAppSettings(input: UpdateAppSettingsInput): void {
    const upsert = this.db
      .prepare(
        `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (@key, @value, @updated_at)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at;
      `,
      );

    const transaction = this.db.transaction(() => {
      const updatedAt = nowIso();
      upsert.run({
        key: APP_SETTING_DISCORD_WEBHOOK_URL,
        value: input.discordWebhookUrl,
        updated_at: updatedAt,
      });
      upsert.run({
        key: APP_SETTING_QUEUE_PARALLEL_ENABLED,
        value: input.queueParallelEnabled ? "1" : "0",
        updated_at: updatedAt,
      });
    });

    transaction();
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
      .prepare(
        `
        INSERT INTO discovery_sessions (
          id, project_path, project_id, project_key, seed_sentence, additional_context,
          answer_history_json, round_number, latest_state_json,
          status, created_at, updated_at
        ) VALUES (
          @id, @project_path, @project_id, @project_key, @seed_sentence, @additional_context,
          @answer_history_json, @round_number, @latest_state_json,
          @status, @created_at, @updated_at
        );
      `,
      )
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
        updated_at: now,
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
      updatedAt: now,
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
      updated_at: nowIso(),
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
      console.error(
        `[AppDatabase] Failed to parse answer_history_json for discovery session ${row.id}`,
      );
      answerHistory = [];
    }

    let latestState: DiscoveryInterviewState;
    try {
      latestState = JSON.parse(row.latest_state_json) as DiscoveryInterviewState;
    } catch (error: unknown) {
      console.error(
        `[AppDatabase] Failed to parse latest_state_json for discovery session ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      updatedAt: row.updated_at,
    };
  }

  /**
   * Return all runs still marked as 'in_progress' whose started_at is older
   * than the given threshold (ISO timestamp).  Used to detect stale runs that
   * lost their in-memory ActiveRun tracking (e.g. after app restart).
   */
  getStaleInProgressRuns(olderThan: string): TaskRun[] {
    return this.runRepo.getStaleInProgressRuns(olderThan);
  }

  close(): void {
    this.db.close();
  }
}
