import { useCallback, useEffect, useMemo } from "react";
import type { JSX } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { RalphTask, TaskRun } from "@shared/types";
import { usePlanStore } from "../stores/planStore";
import { useRunStore, initRunEventSubscription } from "../stores/runStore";
import { USkeleton } from "../components/ui";
import { PlanOverview } from "../components/plan/PlanOverview";
import { TechnicalPackPanel } from "../components/plan/TechnicalPackPanel";
import { TaskCard } from "../components/plan/TaskCard";
import { RecentEvents } from "../components/plan/RecentEvents";
import styles from "./PlanDetailView.module.css";

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Build a map from taskId -> most recent TaskRun.
 * Sorts runs by startedAt DESC so the newest run per task always wins,
 * regardless of the input array ordering.
 */
function buildTaskRunMap(runs: TaskRun[]): Map<string, TaskRun> {
  const sorted = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  const map = new Map<string, TaskRun>();
  for (const run of sorted) {
    if (!map.has(run.taskId)) {
      map.set(run.taskId, run);
    }
  }
  return map;
}

/* ── Component ─────────────────────────────────────────── */

/**
 * PlanDetailView -- shows a single plan with its checklist tasks, technical
 * pack, live run panel, and recent events.
 *
 * Route: /plan/:planId
 *
 * Reads planId from route params. Loads the plan from planStore on mount
 * and whenever planId changes. Subscribes to run events via runStore to
 * keep the plan data fresh as tasks complete.
 */
export function PlanDetailView(): JSX.Element {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  /* ── Zustand store selectors ─────────────────────────── */
  const currentPlan = usePlanStore((s) => s.currentPlan);
  const loadingPlan = usePlanStore((s) => s.loadingPlan);
  const planError = usePlanStore((s) => s.error);
  const loadPlan = usePlanStore((s) => s.loadPlan);

  const recentEvents = useRunStore((s) => s.recentEvents);
  const selectedRunId = useRunStore((s) => s.selectedRunId);
  const runLogs = useRunStore((s) => s.runLogs);
  const runTodos = useRunStore((s) => s.runTodos);
  const selectRun = useRunStore((s) => s.selectRun);

  /* ── Load plan on mount and when planId changes ──────── */
  useEffect(() => {
    if (planId) {
      void loadPlan(planId);
    }
  }, [planId, loadPlan]);

  /* ── Subscribe to run events (reload plan on task completion) ── */
  useEffect(() => {
    const unsubscribe = initRunEventSubscription();
    return unsubscribe;
  }, []);

  /* Re-load plan whenever a run completes/fails/cancels */
  useEffect(() => {
    const latestEvent = recentEvents[0];
    if (
      latestEvent &&
      planId &&
      (latestEvent.type === "completed" ||
        latestEvent.type === "failed" ||
        latestEvent.type === "cancelled" ||
        latestEvent.type === "task_status")
    ) {
      void loadPlan(planId);
    }
    // Only react to the newest event arriving, not the whole array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentEvents[0]?.id, planId, loadPlan]);

  /* ── Derived state ───────────────────────────────────── */
  const plan = currentPlan?.id === planId ? currentPlan : null;

  const latestRunByTask = useMemo(
    () => (plan ? buildTaskRunMap(plan.runs) : new Map<string, TaskRun>()),
    [plan]
  );

  const selectedRun = useMemo(
    () => (plan?.runs ?? []).find((run) => run.id === selectedRunId) ?? null,
    [plan, selectedRunId]
  );

  /** Events filtered to the current plan only. */
  const planEvents = useMemo(
    () => (planId ? recentEvents.filter((e) => e.planId === planId) : []),
    [recentEvents, planId]
  );

  /* ── Callbacks ───────────────────────────────────────── */
  const handleRunTask = useCallback(
    async (task: RalphTask) => {
      if (!plan) return;
      const api = window.ralphApi;
      if (!api) return;
      try {
        const result = await api.runTask({ planId: plan.id, taskId: task.id });
        selectRun(result.runId);
      } catch {
        // Error will be surfaced by planStore if the plan reloads
      }
    },
    [plan, selectRun]
  );

  const handleRunAll = useCallback(async () => {
    if (!plan) return;
    const api = window.ralphApi;
    if (!api) return;
    try {
      await api.runAll({ planId: plan.id });
    } catch {
      // Error will be surfaced on next plan reload
    }
  }, [plan]);

  const handleCancelRun = useCallback(async () => {
    if (!selectedRunId) return;
    const api = window.ralphApi;
    if (!api) return;
    try {
      await api.cancelRun({ runId: selectedRunId });
    } catch {
      // Swallow; plan reload will reflect the latest status
    }
  }, [selectedRunId]);

  const handleRetryTask = useCallback(
    async (task: RalphTask) => {
      if (!plan) return;
      const api = window.ralphApi;
      if (!api) return;
      try {
        const result = await api.retryTask({ planId: plan.id, taskId: task.id });
        selectRun(result.runId);
      } catch {
        // Error will be surfaced by planStore if the plan reloads
      }
    },
    [plan, selectRun]
  );

  const handleSkipTask = useCallback(
    async (task: RalphTask) => {
      if (!plan) return;
      const api = window.ralphApi;
      if (!api) return;
      try {
        await api.skipTask({ planId: plan.id, taskId: task.id });
        void loadPlan(plan.id);
      } catch {
        // Error will be surfaced on next plan reload
      }
    },
    [plan, loadPlan]
  );

  const handleAbortQueue = useCallback(async () => {
    if (!plan) return;
    const api = window.ralphApi;
    if (!api) return;
    try {
      await api.abortQueue({ planId: plan.id });
      void loadPlan(plan.id);
    } catch {
      // Swallow; plan reload will reflect the latest status
    }
  }, [plan, loadPlan]);

  const handleOpenRun = useCallback(
    (runId: string) => {
      selectRun(runId);
      navigate(`/run/${runId}`);
    },
    [selectRun, navigate]
  );

  /* ── Loading state ───────────────────────────────────── */
  if (!planId) {
    return (
      <section className={styles.view}>
        <p className={styles.emptyMessage}>No plan ID provided. Select a plan from the sidebar.</p>
      </section>
    );
  }

  if (loadingPlan && !plan) {
    return (
      <section className={styles.view}>
        <div className={styles.grid}>
          {/* Overview skeleton */}
          <div className={styles.spanHalf}>
            <div className={styles.skeletonPanel}>
              <div className={styles.skeletonPanelHeader}>
                <USkeleton variant="text" width="40%" height="1.4em" />
                <USkeleton variant="text" width="70px" height="1.4em" />
              </div>
              <USkeleton variant="text" lines={3} />
              <div className={styles.skeletonMetaRow}>
                <USkeleton variant="text" width="30%" />
                <USkeleton variant="text" width="20%" />
                <USkeleton variant="text" width="25%" />
              </div>
            </div>
          </div>
          {/* Technical pack skeleton */}
          <div className={styles.spanHalf}>
            <div className={styles.skeletonPanel}>
              <USkeleton variant="text" width="50%" height="1.4em" />
              <div className={styles.skeletonTwoCol}>
                <div>
                  <USkeleton variant="text" width="60%" height="1.1em" />
                  <USkeleton variant="text" lines={3} />
                </div>
                <div>
                  <USkeleton variant="text" width="50%" height="1.1em" />
                  <USkeleton variant="text" lines={2} />
                </div>
              </div>
            </div>
          </div>
          {/* Checklist skeleton */}
          <div className={styles.spanFull}>
            <div className={styles.skeletonPanel}>
              <USkeleton variant="text" width="30%" height="1.4em" />
              <USkeleton variant="card" height="80px" />
              <USkeleton variant="card" height="80px" />
              <USkeleton variant="card" height="80px" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (planError && !plan) {
    return (
      <section className={styles.view}>
        <div className={cn(styles.errorPanel)}>
          <p>{planError}</p>
        </div>
      </section>
    );
  }

  if (!plan) {
    return (
      <section className={styles.view}>
        <p className={styles.emptyMessage}>Plan not found.</p>
      </section>
    );
  }

  /* ── Main render ─────────────────────────────────────── */
  return (
    <section className={styles.view}>
      <div className={styles.grid}>
        {/* Plan Overview */}
        <div className={styles.spanHalf}>
          <PlanOverview plan={plan} />
        </div>

        {/* Technical Pack */}
        <div className={styles.spanHalf}>
          <TechnicalPackPanel technicalPack={plan.technicalPack} />
        </div>

        {/* Checklist Panel */}
        <div className={styles.spanFull}>
          <div className={styles.checklistHeader}>
            <h2>Checklist</h2>
            <button
              type="button"
              className={styles.runAllBtn}
              onClick={() => void handleRunAll()}
            >
              Run Next Available Tasks
            </button>
          </div>
          <div className={styles.taskList}>
            {plan.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                latestRun={latestRunByTask.get(task.id) ?? null}
                onRunTask={(t) => void handleRunTask(t)}
                onOpenRun={handleOpenRun}
                onRetryTask={(t) => void handleRetryTask(t)}
                onSkipTask={(t) => void handleSkipTask(t)}
                onAbortQueue={() => void handleAbortQueue()}
                queueRunning={plan.status === "running"}
              />
            ))}
          </div>
        </div>

        {/* Live Run Panel */}
        <div className={styles.spanFull}>
          <div className={styles.liveRunCard}>
            <div className={styles.liveRunHeader}>
              <h2>Live Run</h2>
              <div className={styles.liveRunActions}>
                {selectedRun ? (
                  <span className={styles.runStatus}>{selectedRun.status}</span>
                ) : null}
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => void handleCancelRun()}
                  disabled={!selectedRunId}
                >
                  Cancel Run
                </button>
              </div>
            </div>

            {selectedRun ? (
              <div className={styles.runContent}>
                <div className={styles.runMeta}>
                  <span>Run: {selectedRun.id}</span>
                  <span>Task: {selectedRun.taskId}</span>
                  <span>Stop reason: {selectedRun.stopReason ?? "n/a"}</span>
                </div>

                <h3>Todo Snapshot</h3>
                <ul className={styles.todoList}>
                  {(runTodos[selectedRun.id] ?? []).map((todo, index) => (
                    <li key={`${todo.content}-${index}`}>
                      <strong>[{todo.status}]</strong> {todo.activeForm || todo.content}
                    </li>
                  ))}
                </ul>

                <h3>Streamed Logs</h3>
                <pre className={styles.logBox}>
                  {(runLogs[selectedRun.id] ?? []).join("") || "No streamed logs yet."}
                </pre>

                {selectedRun.resultText ? (
                  <>
                    <h3>Final Result</h3>
                    <pre className={styles.logBox}>{selectedRun.resultText}</pre>
                  </>
                ) : null}
              </div>
            ) : (
              <p className={styles.emptyMessage}>
                Select a run to inspect live logs and completion details.
              </p>
            )}
          </div>
        </div>

        {/* Recent Events */}
        <div className={styles.spanFull}>
          <RecentEvents events={planEvents} />
        </div>
      </div>
    </section>
  );
}
