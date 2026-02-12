import type { JSX } from "react";
import type { RalphTask, TaskRun } from "@shared/types";
import { UStatusPill } from "../ui";
import styles from "./TaskCard.module.css";

export interface TaskCardProps {
  task: RalphTask;
  /** The most recent run for this task, if any. */
  latestRun: TaskRun | null;
  /** Whether the card body is expanded. Controlled by parent. */
  expanded: boolean;
  /** Called when the user toggles expand/collapse. */
  onToggleExpand: (taskId: string) => void;
  /** Called when the user clicks "Run Task". */
  onRunTask: (task: RalphTask) => void;
  /** Called when the user clicks "Open Latest Run". */
  onOpenRun: (runId: string) => void;
  /** Called when the user clicks "Retry" on a failed task. */
  onRetryTask?: (task: RalphTask) => void;
  /** Called when the user clicks "Skip" on a failed task. */
  onSkipTask?: (task: RalphTask) => void;
  /** Called when the user clicks "Abort Queue". */
  onAbortQueue?: () => void;
  /** Whether a queue is currently running for this plan. */
  queueRunning?: boolean;
}

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Component ─────────────────────────────────────────── */

/**
 * TaskCard -- self-contained card for a single plan task.
 *
 * Displays task title, status pill, collapsible description,
 * dependencies, acceptance criteria, technical notes, and action buttons.
 */
export function TaskCard({
  task,
  latestRun,
  expanded,
  onToggleExpand,
  onRunTask,
  onOpenRun,
  onRetryTask,
  onSkipTask,
  onAbortQueue,
  queueRunning
}: TaskCardProps): JSX.Element {

  return (
    <div className={styles.card}>
      {/* Header: ordinal + title + status pill */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.expandToggle}
          onClick={() => onToggleExpand(task.id)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse task details" : "Expand task details"}
        >
          <span className={cn(styles.chevron, expanded && styles.chevronOpen)} aria-hidden="true">
            {"\u25B6"}
          </span>
          <strong>
            #{task.ordinal} {task.title}
          </strong>
        </button>
        <UStatusPill status={task.status} />
      </div>

      {/* Collapsible body */}
      <div className={cn(styles.body, expanded && styles.bodyOpen)}>
        {/* Description */}
        <p className={styles.description}>{task.description}</p>

        {/* Meta: ID and dependencies */}
        <div className={styles.meta}>
          <span>ID: {task.id}</span>
          <span>
            Depends on: {task.dependencies.length > 0 ? task.dependencies.join(", ") : "none"}
          </span>
        </div>

        {/* Acceptance criteria */}
        {task.acceptanceCriteria.length > 0 ? (
          <div className={styles.criteriaSection}>
            <h4 className={styles.sectionLabel}>Acceptance Criteria</h4>
            <ul className={styles.criteriaList}>
              {task.acceptanceCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Technical notes */}
        {task.technicalNotes ? (
          <p className={styles.notes}>{task.technicalNotes}</p>
        ) : null}

        {/* Actions */}
        <div className={styles.actions}>
          {task.status === "failed" ? (
            <>
              {onRetryTask ? (
                <button
                  type="button"
                  className={cn(styles.btn, styles.btnPrimary)}
                  onClick={() => onRetryTask(task)}
                >
                  Retry
                </button>
              ) : null}
              {onSkipTask ? (
                <button
                  type="button"
                  className={cn(styles.btn, styles.btnGhost)}
                  onClick={() => onSkipTask(task)}
                >
                  Skip
                </button>
              ) : null}
              {onAbortQueue && queueRunning ? (
                <button
                  type="button"
                  className={cn(styles.btn, styles.btnDanger)}
                  onClick={() => onAbortQueue()}
                >
                  Abort Queue
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className={cn(styles.btn, styles.btnPrimary)}
              onClick={() => onRunTask(task)}
            >
              Run Task
            </button>
          )}
          {latestRun ? (
            <button
              type="button"
              className={cn(styles.btn, styles.btnGhost)}
              onClick={() => onOpenRun(latestRun.id)}
            >
              Open Latest Run
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
