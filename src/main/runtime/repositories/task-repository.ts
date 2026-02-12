import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type {
  RalphTask,
  TaskFollowupProposal,
  TaskFollowupProposalStatus,
  TaskStatus,
} from "@shared/types";
import { nowIso } from "./shared-utils";
import {
  type TaskFollowupProposalRow,
  type TaskRow,
  mapTaskFollowupProposalRow,
  mapTaskRow,
} from "./row-mappers";

/**
 * Encapsulates all task-centric persistence operations.
 *
 * Owns: tasks, task_followup_proposals.
 * Cross-domain reads: plans (ordinal max, plan updated_at touch on approval).
 */
export class TaskRepository {
  constructor(private readonly conn: BetterSqlite3.Database) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Get a single task by plan ID and task ID.
   */
  getTask(planId: string, taskId: string): RalphTask | null {
    const row = this.conn
      .prepare("SELECT * FROM tasks WHERE plan_id = ? AND id = ? LIMIT 1;")
      .get(planId, taskId) as TaskRow | undefined;

    if (!row) {
      return null;
    }

    return mapTaskRow(row);
  }

  /**
   * Get all tasks for a plan, ordered by ordinal ASC.
   */
  getTasks(planId: string): RalphTask[] {
    const rows = this.conn
      .prepare("SELECT * FROM tasks WHERE plan_id = ? ORDER BY ordinal ASC;")
      .all(planId) as TaskRow[];

    return rows.map(mapTaskRow);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Update a task's status and conditionally set completed_at.
   * - status = 'completed' → sets completed_at to now
   * - status = 'pending' → clears completed_at
   * - other statuses → preserves existing completed_at
   */
  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const timestamp = nowIso();

    this.conn
      .prepare(
        `
        UPDATE tasks
        SET status = @status,
            updated_at = @updated_at,
            completed_at = CASE
              WHEN @status = 'completed' THEN @updated_at
              WHEN @status = 'pending' THEN NULL
              ELSE completed_at
            END
        WHERE id = @id;
      `,
      )
      .run({
        id: taskId,
        status,
        updated_at: timestamp,
      });
  }

  // ---------------------------------------------------------------------------
  // Dependency-aware queries
  // ---------------------------------------------------------------------------

  /**
   * Count tasks that are pending and have all dependencies satisfied
   * (completed or skipped).
   */
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

  /**
   * Find the first pending task (by ordinal) whose dependencies are all
   * satisfied (completed or skipped). Returns null if none are runnable.
   */
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

  // ---------------------------------------------------------------------------
  // Task Followup Proposals
  // ---------------------------------------------------------------------------

  /**
   * Create a new followup proposal. Uses ON CONFLICT DO NOTHING to
   * deduplicate by (plan_id, finding_key). Returns true if a row was inserted.
   */
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
    const now = nowIso();
    const result = this.conn
      .prepare(
        `
        INSERT INTO task_followup_proposals (
          id, plan_id, source_run_id, source_task_id, finding_key,
          title, description, severity, rule, location, message, recommended_action,
          acceptance_criteria_json, technical_notes,
          status, approved_task_id, created_at, updated_at
        ) VALUES (
          @id, @plan_id, @source_run_id, @source_task_id, @finding_key,
          @title, @description, @severity, @rule, @location, @message, @recommended_action,
          @acceptance_criteria_json, @technical_notes,
          'proposed', NULL, @created_at, @updated_at
        )
        ON CONFLICT(plan_id, finding_key) DO NOTHING;
      `,
      )
      .run({
        id: randomUUID(),
        plan_id: input.planId,
        source_run_id: input.sourceRunId ?? null,
        source_task_id: input.sourceTaskId,
        finding_key: input.findingKey,
        title: input.title,
        description: input.description,
        severity: input.severity,
        rule: input.rule,
        location: input.location,
        message: input.message,
        recommended_action: input.recommendedAction,
        acceptance_criteria_json: JSON.stringify(input.acceptanceCriteria),
        technical_notes: input.technicalNotes,
        created_at: now,
        updated_at: now,
      });

    return result.changes > 0;
  }

  /**
   * List followup proposals for a plan, optionally filtered by status.
   */
  listTaskFollowupProposals(
    planId: string,
    statuses?: TaskFollowupProposalStatus[],
  ): TaskFollowupProposal[] {
    const rows = this.conn
      .prepare(
        `
        SELECT
          id, plan_id, source_run_id, source_task_id, finding_key,
          title, description, severity, rule, location, message, recommended_action,
          acceptance_criteria_json, technical_notes,
          status, approved_task_id, created_at, updated_at
        FROM task_followup_proposals
        WHERE plan_id = @plan_id
        ORDER BY created_at DESC;
      `,
      )
      .all({
        plan_id: planId,
      }) as TaskFollowupProposalRow[];

    const filteredRows =
      statuses && statuses.length > 0 ? rows.filter((row) => statuses.includes(row.status)) : rows;

    return filteredRows.map(mapTaskFollowupProposalRow);
  }

  /**
   * Approve a followup proposal: creates a new task from the proposal data,
   * marks the proposal as approved, and touches the parent plan's updated_at.
   * Returns the new task ID, or null if the proposal was not found or not in 'proposed' state.
   */
  approveTaskFollowupProposal(input: {
    planId: string;
    proposalId: string;
  }): { taskId: string } | null {
    const transaction = this.conn.transaction(() => {
      const proposal = this.conn
        .prepare(
          `
          SELECT
            id, plan_id, source_run_id, source_task_id, finding_key,
            title, description, severity, rule, location, message, recommended_action,
            acceptance_criteria_json, technical_notes,
            status, approved_task_id, created_at, updated_at
          FROM task_followup_proposals
          WHERE id = @id AND plan_id = @plan_id
          LIMIT 1;
        `,
        )
        .get({
          id: input.proposalId,
          plan_id: input.planId,
        }) as TaskFollowupProposalRow | undefined;

      if (!proposal || proposal.status !== "proposed") {
        return null;
      }

      const maxOrdinalRow = this.conn
        .prepare("SELECT MAX(ordinal) AS max_ordinal FROM tasks WHERE plan_id = @plan_id;")
        .get({
          plan_id: input.planId,
        }) as { max_ordinal: number | null } | undefined;
      const nextOrdinal = (maxOrdinalRow?.max_ordinal ?? 0) + 1;

      const taskId = randomUUID();
      const now = nowIso();
      const sourceTaskExists = this.conn
        .prepare(
          `
          SELECT 1
          FROM tasks
          WHERE id = @task_id
            AND plan_id = @plan_id
          LIMIT 1;
        `,
        )
        .get({
          task_id: proposal.source_task_id,
          plan_id: input.planId,
        }) as { 1: number } | undefined;
      const dependencies = sourceTaskExists ? [proposal.source_task_id] : [];

      this.conn
        .prepare(
          `
          INSERT INTO tasks (
            id, plan_id, ordinal, title, description,
            dependencies_json, acceptance_criteria_json, technical_notes,
            status, created_at, updated_at, completed_at
          ) VALUES (
            @id, @plan_id, @ordinal, @title, @description,
            @dependencies_json, @acceptance_criteria_json, @technical_notes,
            'pending', @created_at, @updated_at, NULL
          );
        `,
        )
        .run({
          id: taskId,
          plan_id: input.planId,
          ordinal: nextOrdinal,
          title: proposal.title,
          description: proposal.description,
          dependencies_json: JSON.stringify(dependencies),
          acceptance_criteria_json: proposal.acceptance_criteria_json,
          technical_notes: `${proposal.technical_notes}\n\nApproved from proposal ${proposal.id}.`,
          created_at: now,
          updated_at: now,
        });

      const updateResult = this.conn
        .prepare(
          `
          UPDATE task_followup_proposals
          SET status = 'approved',
              approved_task_id = @approved_task_id,
              updated_at = @updated_at
          WHERE id = @id
            AND plan_id = @plan_id
            AND status = 'proposed';
        `,
        )
        .run({
          id: input.proposalId,
          plan_id: input.planId,
          approved_task_id: taskId,
          updated_at: now,
        });

      if (updateResult.changes === 0) {
        throw new Error(`Proposal approval race detected for proposal ${input.proposalId}.`);
      }

      this.conn.prepare("UPDATE plans SET updated_at = @updated_at WHERE id = @plan_id;").run({
        plan_id: input.planId,
        updated_at: now,
      });

      return { taskId };
    });

    return transaction();
  }

  /**
   * Dismiss a followup proposal. Returns true if the proposal was found and dismissed.
   */
  dismissTaskFollowupProposal(input: { planId: string; proposalId: string }): boolean {
    const result = this.conn
      .prepare(
        `
        UPDATE task_followup_proposals
        SET status = 'dismissed',
            updated_at = @updated_at
        WHERE id = @id
          AND plan_id = @plan_id
          AND status = 'proposed';
      `,
      )
      .run({
        id: input.proposalId,
        plan_id: input.planId,
        updated_at: nowIso(),
      });

    return result.changes > 0;
  }
}
