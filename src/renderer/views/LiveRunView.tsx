import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { RunEvent, TaskRun, TodoItem } from "@shared/types";
import { usePlanStore } from "../stores/planStore";
import { useRunStore, initRunEventSubscription } from "../stores/runStore";
import { UStatusPill, ULogViewer } from "../components/ui";
import styles from "./LiveRunView.module.css";

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Format a duration in milliseconds into a human-readable string.
 * Examples: "1.2s", "45s", "2m 15s", "1h 3m"
 */
function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "--";

  const totalSeconds = Math.floor(ms / 1000);

  if (totalSeconds < 1) {
    return `${ms}ms`;
  }

  if (totalSeconds < 60) {
    const fraction = (ms / 1000).toFixed(1);
    return `${fraction}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Format a cost in USD with up to 4 decimal places.
 */
function formatCostUsd(cost: number | null): string {
  if (cost === null) return "--";
  return `$${cost.toFixed(4)}`;
}

/**
 * Format an ISO timestamp to a short localized datetime.
 */
function formatTimestamp(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Get a CSS class for a todo item status.
 */
function todoStatusClass(status: string): string {
  switch (status) {
    case "in_progress":
      return styles.todoStatusInProgress;
    case "completed":
      return styles.todoStatusCompleted;
    default:
      return styles.todoStatusPending;
  }
}

interface ArchitectureFinding {
  severity: string;
  location: string;
  rule: string;
  message: string;
  recommendedAction: string;
}

interface ArchitectureReviewSnapshot {
  eventId: string;
  ts: string;
  iteration: number;
  maxIterations: number;
  status: string;
  summary: string;
  confidence: number | null;
  findings: ArchitectureFinding[];
}

function parseArchitectureReviewEvent(event: RunEvent): ArchitectureReviewSnapshot | null {
  if (event.type !== "info") {
    return null;
  }

  const payload = event.payload as { data?: unknown } | undefined;
  const data = payload?.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (record.kind !== "architecture_review") {
    return null;
  }

  const review = record.review as Record<string, unknown> | undefined;
  if (!review) {
    return null;
  }

  const findingsRaw = Array.isArray(review.findings) ? review.findings : [];
  const findings: ArchitectureFinding[] = findingsRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      severity: String(item.severity ?? "unknown"),
      location: String(item.location ?? "unknown"),
      rule: String(item.rule ?? "other"),
      message: String(item.message ?? ""),
      recommendedAction: String(item.recommendedAction ?? ""),
    }));

  return {
    eventId: event.id,
    ts: event.ts,
    iteration: Number(record.iteration ?? 0),
    maxIterations: Number(record.maxIterations ?? 0),
    status: String(review.status ?? "unknown"),
    summary: String(review.summary ?? ""),
    confidence: typeof review.confidence === "number" ? review.confidence : null,
    findings,
  };
}

/* ── Component ─────────────────────────────────────────── */

/**
 * LiveRunView -- real-time log streaming and run details for a specific run.
 *
 * Route: /run/:runId
 *
 * Reads runId from route params. Loads run metadata from the plan's runs
 * array (via planStore). Shows ULogViewer with full log output, a todo
 * snapshot display, run metadata (status, duration, cost), and a cancel
 * button for active runs.
 */
export function LiveRunView(): JSX.Element {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();

  /* ── Zustand store selectors ─────────────────────────── */
  const currentPlan = usePlanStore((s) => s.currentPlan);
  const loadPlan = usePlanStore((s) => s.loadPlan);

  const activeRuns = useRunStore((s) => s.activeRuns);
  const runLogs = useRunStore((s) => s.runLogs);
  const runLogOverflow = useRunStore((s) => s.runLogOverflow);
  const runTodos = useRunStore((s) => s.runTodos);
  const recentEvents = useRunStore((s) => s.recentEvents);
  const cancelRequestedAt = useRunStore((s) => s.cancelRequestedAt);
  const getCancelTimeoutMs = useRunStore((s) => s.getCancelTimeoutMs);

  /* ── Subscribe to run events ─────────────────────────── */
  useEffect(() => {
    const unsubscribe = initRunEventSubscription();
    return unsubscribe;
  }, []);

  /* ── Locate the run in the current plan's runs array ── */
  const run: TaskRun | null = useMemo(() => {
    if (!currentPlan || !runId) return null;
    return currentPlan.runs.find((r) => r.id === runId) ?? null;
  }, [currentPlan, runId]);

  /* ── Re-load plan when run completes/fails/cancels ──── */
  useEffect(() => {
    const latestEvent = recentEvents[0];
    if (
      latestEvent &&
      latestEvent.runId === runId &&
      (latestEvent.type === "completed" ||
        latestEvent.type === "failed" ||
        latestEvent.type === "cancelled")
    ) {
      if (run?.planId) {
        void loadPlan(run.planId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentEvents[0]?.id, runId, run?.planId, loadPlan]);

  /* ── Derived state ───────────────────────────────────── */
  const logs: string[] = runId ? (runLogs[runId] ?? []) : [];
  const logOverflow: number = runId ? (runLogOverflow[runId] ?? 0) : 0;
  const todos: TodoItem[] = runId ? (runTodos[runId] ?? []) : [];
  const architectureReviews = useMemo<ArchitectureReviewSnapshot[]>(() => {
    if (!runId) return [];
    return recentEvents
      .filter((event) => event.runId === runId)
      .map(parseArchitectureReviewEvent)
      .filter((review): review is ArchitectureReviewSnapshot => review !== null);
  }, [recentEvents, runId]);

  /** Determine the run status: prefer activeRuns (live), fall back to TaskRun record. */
  const runStatus = useMemo((): string => {
    if (runId && activeRuns[runId]) return activeRuns[runId];
    if (run) return run.status;
    return "unknown";
  }, [runId, activeRuns, run]);

  const isActive = runStatus === "in_progress" || runStatus === "queued";
  const isCancelling = runStatus === "cancelling";

  /* ── Cancel timeout progress ────────────────────────── */
  const cancelStartMs = runId ? (cancelRequestedAt[runId] ?? null) : null;
  const cancelTimeoutMs = getCancelTimeoutMs();
  const [cancelElapsedMs, setCancelElapsedMs] = useState(0);

  useEffect(() => {
    if (cancelStartMs === null) {
      setCancelElapsedMs(0);
      return;
    }

    const tick = () => {
      const elapsed = Date.now() - cancelStartMs;
      setCancelElapsedMs(Math.min(elapsed, cancelTimeoutMs));
    };

    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [cancelStartMs, cancelTimeoutMs]);

  const cancelProgressPct =
    cancelTimeoutMs > 0 ? Math.round((cancelElapsedMs / cancelTimeoutMs) * 100) : 0;

  /* ── Callbacks ───────────────────────────────────────── */
  const handleCancel = useCallback(async () => {
    if (!runId) return;
    const api = window.ralphApi;
    if (!api) return;
    try {
      await api.cancelRun({ runId });
    } catch {
      // Swallow; the event stream will reflect updated status
    }
  }, [runId]);

  const handleBack = useCallback(() => {
    if (run?.planId) {
      navigate(`/plan/${run.planId}`);
    } else {
      navigate("/");
    }
  }, [run, navigate]);

  /* ── Missing runId ───────────────────────────────────── */
  if (!runId) {
    return (
      <section className={styles.view}>
        <p className={styles.emptyMessage}>
          No run ID provided. Navigate to a run from a plan detail page.
        </p>
      </section>
    );
  }

  /* ── Main render ─────────────────────────────────────── */
  return (
    <section className={styles.view}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={handleBack}
            aria-label="Go back"
          >
            &larr; Back
          </button>
          <h1 className={styles.title}>Live Run</h1>
        </div>

        {isCancelling ? (
          <div className={styles.cancellingGroup}>
            <span className={styles.cancellingLabel}>Cancelling...</span>
            <div className={styles.cancelProgressTrack}>
              <div
                className={styles.cancelProgressBar}
                style={{ width: `${cancelProgressPct}%` }}
              />
            </div>
            <span className={styles.cancelProgressText}>
              {Math.ceil((cancelTimeoutMs - cancelElapsedMs) / 1000)}s
            </span>
          </div>
        ) : isActive ? (
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => void handleCancel()}
            title="Cancel Run (Esc)"
          >
            Cancel Run
          </button>
        ) : null}
      </div>

      {/* Run metadata */}
      <div className={styles.metaCard}>
        <div className={styles.metaRow}>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>Status:</span>
            <UStatusPill status={runStatus} />
          </span>

          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>Run ID:</span>
            <span className={styles.metaValue}>{runId}</span>
          </span>

          {run ? (
            <>
              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Task:</span>
                <span className={styles.metaValue}>{run.taskId}</span>
              </span>

              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Started:</span>
                <span>{formatTimestamp(run.startedAt)}</span>
              </span>

              {run.endedAt ? (
                <span className={styles.metaItem}>
                  <span className={styles.metaLabel}>Ended:</span>
                  <span>{formatTimestamp(run.endedAt)}</span>
                </span>
              ) : null}

              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Duration:</span>
                <span>{formatDuration(run.durationMs)}</span>
              </span>

              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Cost:</span>
                <span className={cn(run.totalCostUsd !== null && styles.costValue)}>
                  {formatCostUsd(run.totalCostUsd)}
                </span>
              </span>

              {run.stopReason ? (
                <span className={styles.metaItem}>
                  <span className={styles.metaLabel}>Stop reason:</span>
                  <span>{run.stopReason}</span>
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Content grid: todos + log viewer */}
      <div className={styles.contentGrid}>
        {/* Todo snapshot */}
        <div className={styles.todoPanel}>
          <h2 className={styles.todoPanelTitle}>Todo Snapshot</h2>
          {todos.length > 0 ? (
            <ul className={styles.todoList}>
              {todos.map((todo, index) => (
                <li key={`${todo.content}-${index}`} className={styles.todoItem}>
                  <span className={cn(styles.todoStatus, todoStatusClass(todo.status))}>
                    {todo.status.replace(/_/g, " ")}
                  </span>
                  <span className={styles.todoContent}>{todo.activeForm || todo.content}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.todoEmpty}>No todo items yet.</p>
          )}
        </div>

        {/* Architecture review snapshots */}
        <div className={styles.archPanel}>
          <h2 className={styles.archPanelTitle}>Architecture Review</h2>
          {architectureReviews.length > 0 ? (
            <ul className={styles.archList}>
              {architectureReviews.map((review) => (
                <li key={review.eventId} className={styles.archItem}>
                  <div className={styles.archHeaderRow}>
                    <span className={styles.archMeta}>
                      Iteration {review.iteration}/{review.maxIterations || "--"}
                    </span>
                    <span className={styles.archMeta}>{formatTimestamp(review.ts)}</span>
                  </div>
                  <div className={styles.archStatusRow}>
                    <span className={styles.archStatusLabel}>status:</span>
                    <span className={cn(styles.archStatus, styles[`archStatus_${review.status}`])}>
                      {review.status}
                    </span>
                    {review.confidence !== null ? (
                      <span className={styles.archConfidence}>
                        confidence: {review.confidence}%
                      </span>
                    ) : null}
                  </div>
                  <p className={styles.archSummary}>{review.summary || "No summary."}</p>

                  {review.findings.length > 0 ? (
                    <ul className={styles.archFindings}>
                      {review.findings.map((finding, index) => (
                        <li key={`${review.eventId}-${index}`} className={styles.archFinding}>
                          <strong>[{finding.severity}]</strong> ({finding.rule}) {finding.location}:{" "}
                          {finding.message}
                          {finding.recommendedAction ? (
                            <div className={styles.archAction}>
                              Action: {finding.recommendedAction}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.archNoFindings}>No findings.</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.archEmpty}>No architecture review snapshots yet.</p>
          )}
        </div>

        {/* Log viewer */}
        <div className={styles.logSection}>
          <h2 className={styles.logSectionTitle}>Streamed Logs</h2>
          <ULogViewer
            lines={logs}
            height={500}
            autoScroll={isActive}
            truncatedCount={logOverflow}
          />
        </div>

        {/* Result text (only when run has finished with a result) */}
        {run?.resultText ? (
          <div className={styles.resultSection}>
            <div className={styles.resultCard}>
              <h2 className={styles.resultTitle}>Final Result</h2>
              <pre className={styles.resultText}>{run.resultText}</pre>
            </div>
          </div>
        ) : null}

        {/* Error text (only when run has failed with an error) */}
        {run?.errorText ? (
          <div className={styles.errorSection}>
            <div className={styles.errorCard}>
              <h2 className={styles.errorTitle}>Error</h2>
              <pre className={styles.errorText}>{run.errorText}</pre>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
