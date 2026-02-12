import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type {
  TaskFollowupProposal,
  TaskFollowupProposalStatus,
} from "@shared/types";
import { nowIso } from "./shared-utils";
import { type TaskFollowupProposalRow, mapTaskFollowupProposalRow } from "./row-mappers";

// ---------------------------------------------------------------------------
// Input interfaces
// ---------------------------------------------------------------------------

export interface CreateProposalInput {
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
}

export interface ApproveProposalInput {
  planId: string;
  proposalId: string;
}

export interface DismissProposalInput {
  planId: string;
  proposalId: string;
}

/**
 * Encapsulates all task-followup-proposal persistence operations.
 *
 * Owns: task_followup_proposals.
 * Cross-domain writes: tasks (on approval, creates a new task row),
 *   plans (on approval, touches updated_at).
 */
export class ProposalRepository {
  constructor(private readonly conn: BetterSqlite3.Database) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Create a new followup proposal. Uses ON CONFLICT DO NOTHING to
   * deduplicate by (plan_id, finding_key). Returns true if a row was inserted.
   */
  createTaskFollowupProposal(input: CreateProposalInput): boolean {
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

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Approve (transactional, cross-domain)
  // ---------------------------------------------------------------------------

  /**
   * Approve a followup proposal: creates a new task from the proposal data,
   * marks the proposal as approved, and touches the parent plan's updated_at.
   * If an equivalent pending/in-progress task already exists, links to it instead
   * of creating a duplicate task row.
   * Returns the target task ID + creation mode, or null if proposal was not found
   * or not in 'proposed' state.
   */
  approveTaskFollowupProposal(
    input: ApproveProposalInput,
  ): { taskId: string; created: boolean } | null {
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

      const now = nowIso();

      // Check for an existing equivalent task (deduplication).
      const existingTaskRow = this.conn
        .prepare(
          `
          SELECT id
          FROM tasks
          WHERE plan_id = @plan_id
            AND status IN ('pending', 'in_progress')
            AND (
              technical_notes LIKE @finding_marker
              OR (
                title = @title
                AND description = @description
              )
            )
          LIMIT 1;
        `,
        )
        .get({
          plan_id: input.planId,
          finding_marker: `%Follow-up finding key: ${proposal.finding_key}.%`,
          title: proposal.title,
          description: proposal.description,
        }) as { id: string } | undefined;

      if (existingTaskRow?.id) {
        // Link to existing task instead of creating a duplicate.
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
            approved_task_id: existingTaskRow.id,
            updated_at: now,
          });

        if (updateResult.changes === 0) {
          throw new Error(`Proposal approval race detected for proposal ${input.proposalId}.`);
        }

        this.touchPlanUpdatedAt(input.planId, now);

        return { taskId: existingTaskRow.id, created: false };
      }

      // Determine ordinal for the new task.
      const sourceTaskRow = this.conn
        .prepare(
          `
          SELECT ordinal
          FROM tasks
          WHERE id = @task_id
            AND plan_id = @plan_id
          LIMIT 1;
        `,
        )
        .get({
          task_id: proposal.source_task_id,
          plan_id: input.planId,
        }) as { ordinal: number } | undefined;
      const sourceTaskOrdinal = sourceTaskRow?.ordinal ?? null;

      let nextOrdinal: number;
      if (sourceTaskOrdinal !== null) {
        nextOrdinal = sourceTaskOrdinal + 1;
        // Shift subsequent tasks to make room.
        this.conn
          .prepare(
            `
            UPDATE tasks
            SET ordinal = ordinal + 1,
                updated_at = @updated_at
            WHERE plan_id = @plan_id
              AND id <> @source_task_id
              AND ordinal >= @insert_ordinal;
          `,
          )
          .run({
            plan_id: input.planId,
            source_task_id: proposal.source_task_id,
            insert_ordinal: nextOrdinal,
            updated_at: now,
          });
      } else {
        const maxOrdinalRow = this.conn
          .prepare("SELECT MAX(ordinal) AS max_ordinal FROM tasks WHERE plan_id = @plan_id;")
          .get({
            plan_id: input.planId,
          }) as { max_ordinal: number | null } | undefined;
        nextOrdinal = (maxOrdinalRow?.max_ordinal ?? 0) + 1;
      }

      // Create the new task.
      const taskId = randomUUID();
      const sourceTaskExists = sourceTaskOrdinal !== null;
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
          technical_notes:
            `${proposal.technical_notes}\n\n` +
            `Follow-up finding key: ${proposal.finding_key}.\n` +
            `Approved from proposal ${proposal.id}.`,
          created_at: now,
          updated_at: now,
        });

      // Mark the proposal as approved.
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

      this.touchPlanUpdatedAt(input.planId, now);

      return { taskId, created: true };
    });

    return transaction();
  }

  // ---------------------------------------------------------------------------
  // Dismiss
  // ---------------------------------------------------------------------------

  /**
   * Dismiss a followup proposal. Returns true if the proposal was found and dismissed.
   */
  dismissTaskFollowupProposal(input: DismissProposalInput): boolean {
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Touch a plan's updated_at timestamp. Used after proposal approval to
   * signal that the plan aggregate has changed.
   */
  private touchPlanUpdatedAt(planId: string, timestamp: string): void {
    this.conn.prepare("UPDATE plans SET updated_at = @updated_at WHERE id = @plan_id;").run({
      plan_id: planId,
      updated_at: timestamp,
    });
  }
}
