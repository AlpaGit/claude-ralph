import type BetterSqlite3 from "better-sqlite3";
import type { RalphTask, TaskStatus } from "@shared/types";
import { nowIso } from "./shared-utils";
import { type TaskRow, mapTaskRow } from "./row-mappers";

/**
 * Encapsulates all task-centric persistence operations.
 *
 * Owns: tasks.
 * Followup proposals have been moved to {@link ProposalRepository}.
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

}
