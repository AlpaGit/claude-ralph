import { useMemo } from "react";
import type { JSX } from "react";
import type { RalphPlan, RunEvent, TaskRun } from "@shared/types";
import { UCard, UStatusPill } from "../ui";
import styles from "./AgentActivityBoard.module.css";

interface AgentActivityBoardProps {
  plan: RalphPlan;
  events: RunEvent[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}

interface PhaseGroup {
  key: string;
  phaseNumber: number | null;
  runs: ActivityRun[];
}

interface ActivityRun {
  run: TaskRun;
  taskTitle: string;
  phaseNumber: number | null;
  branchName: string | null;
  updatedAt: string;
  stageName: string | null;
  stageStatus: string | null;
  agentRole: string | null;
  stageSummary: string | null;
  subagentType: string | null;
}

interface StartedMetadata {
  phaseNumber: number | null;
  branchName: string | null;
}

interface AgentStageMetadata {
  stageName: string | null;
  stageStatus: string | null;
  agentRole: string | null;
  summary: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseStartedMetadata(payload: unknown): StartedMetadata | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const phaseNumber =
    typeof record.phaseNumber === "number" && Number.isFinite(record.phaseNumber)
      ? record.phaseNumber
      : null;
  const branchNameRaw = typeof record.branchName === "string" ? record.branchName.trim() : "";

  return {
    phaseNumber,
    branchName: branchNameRaw.length > 0 ? branchNameRaw : null
  };
}

function parseAgentStage(payload: unknown): AgentStageMetadata | null {
  const payloadRecord = asRecord(payload);
  const dataRecord = asRecord(payloadRecord?.data);
  if (!dataRecord || dataRecord.kind !== "agent_stage") {
    return null;
  }

  const stageName = typeof dataRecord.stage === "string" ? dataRecord.stage : null;
  const stageStatus = typeof dataRecord.status === "string" ? dataRecord.status : null;
  const agentRole = typeof dataRecord.agentRole === "string" ? dataRecord.agentRole : null;
  const summaryRaw = typeof dataRecord.summary === "string" ? dataRecord.summary.trim() : "";

  return {
    stageName,
    stageStatus,
    agentRole,
    summary: summaryRaw.length > 0 ? summaryRaw : null
  };
}

function parseSubagentType(payload: unknown): string | null {
  const payloadRecord = asRecord(payload);
  const dataRecord = asRecord(payloadRecord?.data);
  if (!dataRecord) {
    return null;
  }

  const raw = typeof dataRecord.subagent_type === "string" ? dataRecord.subagent_type.trim() : "";
  return raw.length > 0 ? raw : null;
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return ts;
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

function toStageStatusPillStatus(status: string | null): string {
  switch (status) {
    case "started":
      return "in_progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

function clampSummary(summary: string | null): string | null {
  if (!summary) {
    return null;
  }
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
}

export function AgentActivityBoard({
  plan,
  events,
  selectedRunId,
  onSelectRun
}: AgentActivityBoardProps): JSX.Element {
  const { phaseGroups, activePhaseCount, activeRunCount } = useMemo(() => {
    const startedByRun = new Map<string, StartedMetadata>();
    const stageByRun = new Map<string, AgentStageMetadata>();
    const subagentByRun = new Map<string, string>();
    const updatedAtByRun = new Map<string, string>();

    for (const event of events) {
      if (!event.runId) {
        continue;
      }

      if (!updatedAtByRun.has(event.runId)) {
        updatedAtByRun.set(event.runId, event.ts);
      }

      if (event.type === "started" && !startedByRun.has(event.runId)) {
        const started = parseStartedMetadata(event.payload);
        if (started) {
          startedByRun.set(event.runId, started);
        }
      }

      if (event.type === "info") {
        if (!stageByRun.has(event.runId)) {
          const stage = parseAgentStage(event.payload);
          if (stage) {
            stageByRun.set(event.runId, stage);
          }
        }

        if (!subagentByRun.has(event.runId)) {
          const subagentType = parseSubagentType(event.payload);
          if (subagentType) {
            subagentByRun.set(event.runId, subagentType);
          }
        }
      }
    }

    const taskById = new Map(plan.tasks.map((task) => [task.id, task.title]));
    const runs = [...plan.runs].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    const phaseGroupMap = new Map<string, PhaseGroup>();

    for (const run of runs) {
      const startedMetadata = startedByRun.get(run.id);
      const stageMetadata = stageByRun.get(run.id);
      const phaseNumber = startedMetadata?.phaseNumber ?? null;
      const phaseKey = phaseNumber !== null ? `phase-${phaseNumber}` : "phase-unknown";

      const activityRun: ActivityRun = {
        run,
        taskTitle: taskById.get(run.taskId) ?? run.taskId,
        phaseNumber,
        branchName: startedMetadata?.branchName ?? null,
        updatedAt: updatedAtByRun.get(run.id) ?? run.endedAt ?? run.startedAt,
        stageName: stageMetadata?.stageName ?? null,
        stageStatus: stageMetadata?.stageStatus ?? null,
        agentRole: stageMetadata?.agentRole ?? null,
        stageSummary: clampSummary(stageMetadata?.summary ?? null),
        subagentType: subagentByRun.get(run.id) ?? null
      };

      const existingGroup = phaseGroupMap.get(phaseKey);
      if (existingGroup) {
        existingGroup.runs.push(activityRun);
      } else {
        phaseGroupMap.set(phaseKey, {
          key: phaseKey,
          phaseNumber,
          runs: [activityRun]
        });
      }
    }

    const phaseGroups = [...phaseGroupMap.values()]
      .map((group) => ({
        ...group,
        runs: group.runs.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
      }))
      .sort((a, b) => {
        if (a.phaseNumber === null && b.phaseNumber !== null) return 1;
        if (a.phaseNumber !== null && b.phaseNumber === null) return -1;
        if (a.phaseNumber === null && b.phaseNumber === null) return 0;
        const left = a.phaseNumber ?? Number.MAX_SAFE_INTEGER;
        const right = b.phaseNumber ?? Number.MAX_SAFE_INTEGER;
        return left - right;
      });

    const activePhaseCount = phaseGroups.filter((group) =>
      group.runs.some((activityRun) => activityRun.run.status === "in_progress")
    ).length;
    const activeRunCount = phaseGroups.reduce((count, group) => {
      return count + group.runs.filter((activityRun) => activityRun.run.status === "in_progress").length;
    }, 0);

    return { phaseGroups, activePhaseCount, activeRunCount };
  }, [events, plan.runs, plan.tasks]);

  return (
    <UCard
      title="Agent Activity"
      subtitle="Track agent stages by phase. Parallel phases are rendered side-by-side."
      className={styles.panel}
      headerAction={
        <span className={styles.summaryBadge}>
          {activeRunCount} active run(s) | {activePhaseCount} active phase(s)
        </span>
      }
    >
      {phaseGroups.length === 0 ? (
        <p className={styles.empty}>No runs yet. Start a task or run the queue to see agent activity.</p>
      ) : (
        <div className={styles.phaseGrid}>
          {phaseGroups.map((phaseGroup) => (
            <section key={phaseGroup.key} className={styles.phaseCard}>
              <div className={styles.phaseHeader}>
                <h3 className={styles.phaseTitle}>
                  {phaseGroup.phaseNumber !== null ? `Phase ${phaseGroup.phaseNumber}` : "Standalone Runs"}
                </h3>
                <span className={styles.phaseStats}>
                  {phaseGroup.runs.filter((activityRun) => activityRun.run.status === "in_progress").length} active /
                  {" "}
                  {phaseGroup.runs.length} total
                </span>
              </div>

              <ul className={styles.runList}>
                {phaseGroup.runs.map((activityRun) => (
                  <li key={activityRun.run.id}>
                    <button
                      type="button"
                      className={`${styles.runRow} ${selectedRunId === activityRun.run.id ? styles.selected : ""}`}
                      onClick={() => onSelectRun(activityRun.run.id)}
                    >
                      <div className={styles.rowTop}>
                        <strong className={styles.taskTitle}>{activityRun.taskTitle}</strong>
                        <UStatusPill status={activityRun.run.status} />
                      </div>

                      <div className={styles.rowMeta}>
                        <span>Run {shortRunId(activityRun.run.id)}</span>
                        <span>Updated {formatTimestamp(activityRun.updatedAt)}</span>
                        <span>Branch {activityRun.branchName ?? "n/a"}</span>
                      </div>

                      <div className={styles.stageLine}>
                        <span>Stage {activityRun.stageName ?? "n/a"}</span>
                        {activityRun.stageStatus ? (
                          <UStatusPill
                            status={toStageStatusPillStatus(activityRun.stageStatus)}
                            label={activityRun.stageStatus}
                          />
                        ) : null}
                      </div>

                      <div className={styles.agentLine}>
                        <span>Agent {activityRun.agentRole ?? "n/a"}</span>
                        <span>Subagent {activityRun.subagentType ?? "n/a"}</span>
                      </div>

                      {activityRun.stageSummary ? (
                        <p className={styles.summaryText}>{activityRun.stageSummary}</p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </UCard>
  );
}
