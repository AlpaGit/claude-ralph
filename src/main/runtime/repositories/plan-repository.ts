import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type {
  ListPlansFilter,
  PlanListItem,
  PlanStatus,
  RalphPlan,
  RalphTask,
  TaskFollowupProposal,
  TaskRun,
  TechnicalPack,
} from "@shared/types";
import { PlanParseError, nowIso } from "./shared-utils";
import {
  type CreatePlanInput,
  type PlanListRow,
  type PlanProgressEntryRow,
  type PlanRow,
  type RunRow,
  type TaskFollowupProposalRow,
  type TaskRow,
  mapPlanListRow,
  mapRunRow,
  mapTaskFollowupProposalRow,
  mapTaskRow,
} from "./row-mappers";

/**
 * Callback that resolves a project path to a project identity.
 * Provided by the parent Database / AppDatabase so PlanRepository
 * doesn't need to know about the projects table directly.
 */
export type TouchProjectFn = (
  projectPath: string,
) => { projectId: string; projectKey: string; canonicalPath: string } | null;

/**
 * Encapsulates all plan-centric persistence operations.
 *
 * Owns: plans, plan_progress_entries.
 * Reads (cross-domain): tasks, runs, task_followup_proposals (for aggregate loads).
 */
export class PlanRepository {
  constructor(
    private readonly conn: BetterSqlite3.Database,
    private readonly touchProject: TouchProjectFn,
  ) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Insert a new plan and all its tasks atomically inside a transaction.
   */
  createPlan(input: CreatePlanInput): void {
    const createdAt = nowIso();
    const project = this.touchProject(input.projectPath);

    const insertPlan = this.conn.prepare(`
      INSERT INTO plans (
        id, project_path, project_id, project_key, prd_text, summary, technical_pack_json, status, created_at, updated_at
      ) VALUES (
        @id, @project_path, @project_id, @project_key, @prd_text, @summary, @technical_pack_json, @status, @created_at, @updated_at
      );
    `);

    const insertTask = this.conn.prepare(`
      INSERT INTO tasks (
        id, plan_id, ordinal, title, description, dependencies_json, acceptance_criteria_json, technical_notes, status, created_at, updated_at, completed_at
      ) VALUES (
        @id, @plan_id, @ordinal, @title, @description, @dependencies_json, @acceptance_criteria_json, @technical_notes, @status, @created_at, @updated_at, NULL
      );
    `);

    const transaction = this.conn.transaction(() => {
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
        updated_at: createdAt,
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
          updated_at: createdAt,
        });
      }
    });

    transaction();
  }

  // ---------------------------------------------------------------------------
  // Read (single)
  // ---------------------------------------------------------------------------

  /**
   * Load a full plan aggregate: plan row + tasks + runs + followup proposals.
   */
  getPlan(planId: string): RalphPlan | null {
    const planRow = this.conn.prepare("SELECT * FROM plans WHERE id = ?;").get(planId) as
      | PlanRow
      | undefined;
    if (!planRow) {
      return null;
    }

    const taskRows = this.conn
      .prepare("SELECT * FROM tasks WHERE plan_id = ? ORDER BY ordinal ASC;")
      .all(planId) as TaskRow[];

    const runRows = this.conn
      .prepare("SELECT * FROM runs WHERE plan_id = ? ORDER BY started_at DESC;")
      .all(planId) as RunRow[];

    const proposalRows = this.conn
      .prepare(
        `
        SELECT
          id, plan_id, source_run_id, source_task_id, finding_key,
          title, description, severity, rule, location, message, recommended_action,
          acceptance_criteria_json, technical_notes,
          status, approved_task_id, created_at, updated_at
        FROM task_followup_proposals
        WHERE plan_id = ?
        ORDER BY created_at DESC;
      `,
      )
      .all(planId) as TaskFollowupProposalRow[];

    let technicalPack: TechnicalPack;
    try {
      technicalPack = JSON.parse(planRow.technical_pack_json) as TechnicalPack;
    } catch (error: unknown) {
      console.error(
        `[PlanRepository] Failed to parse technical_pack_json for plan ${planId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new PlanParseError("technical_pack_json", planId, error);
    }

    const tasks: RalphTask[] = taskRows.map(mapTaskRow);
    const runs: TaskRun[] = runRows.map(mapRunRow);
    const taskProposals: TaskFollowupProposal[] = proposalRows.map(mapTaskFollowupProposalRow);

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
      runs,
      taskProposals,
    };
  }

  // ---------------------------------------------------------------------------
  // Read (list)
  // ---------------------------------------------------------------------------

  /**
   * List plans with optional filtering by archive status and search text.
   * Returns lightweight plan records (no tasks, runs, or PRD body).
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

    const rows = this.conn.prepare(sql).all(params) as PlanListRow[];

    return rows.map(mapPlanListRow);
  }

  /**
   * List plans belonging to a specific project path, ordered newest-first.
   */
  listPlansByProject(projectPath: string, limit = 10): PlanListItem[] {
    const project = this.touchProject(projectPath);
    if (!project) {
      return [];
    }

    const rows = this.conn
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
        project_id: project.projectId,
        limit,
      }) as PlanListRow[];

    return rows.map(mapPlanListRow);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  updatePlanStatus(planId: string, status: PlanStatus): void {
    this.conn
      .prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?;")
      .run(status, nowIso(), planId);
  }

  /**
   * Soft-archive a plan by setting archived_at to the current timestamp.
   */
  archivePlan(planId: string): void {
    const now = nowIso();
    this.conn
      .prepare("UPDATE plans SET archived_at = ?, updated_at = ? WHERE id = ?;")
      .run(now, now, planId);
  }

  /**
   * Remove the archived status from a plan by clearing archived_at.
   */
  unarchivePlan(planId: string): void {
    this.conn
      .prepare("UPDATE plans SET archived_at = NULL, updated_at = ? WHERE id = ?;")
      .run(nowIso(), planId);
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Permanently delete a plan and all associated data (CASCADE).
   */
  deletePlan(planId: string): void {
    this.conn.prepare("DELETE FROM plans WHERE id = ?;").run(planId);
  }

  // ---------------------------------------------------------------------------
  // Plan Progress Entries
  // ---------------------------------------------------------------------------

  /**
   * Append a progress entry to a plan's history log.
   * Silently no-ops if entryText is empty after trimming.
   */
  appendPlanProgressEntry(input: {
    planId: string;
    runId?: string | null;
    status: "completed" | "failed" | "cancelled";
    entryText: string;
  }): void {
    const trimmed = input.entryText.trim();
    if (trimmed.length === 0) {
      return;
    }

    const maxLength = 16_000;
    const truncated =
      trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;

    this.conn
      .prepare(
        `
        INSERT INTO plan_progress_entries (
          id, plan_id, run_id, status, entry_text, created_at
        ) VALUES (
          @id, @plan_id, @run_id, @status, @entry_text, @created_at
        );
      `,
      )
      .run({
        id: randomUUID(),
        plan_id: input.planId,
        run_id: input.runId ?? null,
        status: input.status,
        entry_text: truncated,
        created_at: nowIso(),
      });
  }

  /**
   * List the most recent progress entries for a plan.
   */
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
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const rows = this.conn
      .prepare(
        `
        SELECT id, plan_id, run_id, status, entry_text, created_at
        FROM plan_progress_entries
        WHERE plan_id = @plan_id
        ORDER BY created_at DESC
        LIMIT @limit;
      `,
      )
      .all({
        plan_id: planId,
        limit: boundedLimit,
      }) as PlanProgressEntryRow[];

    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      runId: row.run_id,
      status: row.status,
      entryText: row.entry_text,
      createdAt: row.created_at,
    }));
  }
}
