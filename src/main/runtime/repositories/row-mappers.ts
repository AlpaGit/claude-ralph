import type {
  PlanListItem,
  PlanStatus,
  RalphTask,
  TaskFollowupProposal,
  TaskFollowupProposalStatus,
  TaskRun,
  RunStatus,
  TaskStatus,
} from "@shared/types";
import { parseJsonArray } from "./shared-utils";

// ---------------------------------------------------------------------------
// Row interfaces — one-to-one with SQLite column shapes
// ---------------------------------------------------------------------------

export interface PlanRow {
  id: string;
  project_path: string;
  project_id: string | null;
  project_key: string | null;
  prd_text: string;
  summary: string;
  technical_pack_json: string;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PlanListRow {
  id: string;
  summary: string;
  status: PlanStatus;
  project_path: string;
  project_id: string | null;
  project_key: string | null;
  created_at: string;
  archived_at: string | null;
}

export interface TaskRow {
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

export interface RunRow {
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
  retry_count: number;
}

export interface RunEventRow {
  id: string;
  run_id: string;
  ts: string;
  level: "info" | "error";
  event_type: string;
  payload_json: string;
}

export interface PlanProgressEntryRow {
  id: string;
  plan_id: string;
  run_id: string | null;
  status: "completed" | "failed" | "cancelled";
  entry_text: string;
  created_at: string;
}

export interface TaskFollowupProposalRow {
  id: string;
  plan_id: string;
  source_run_id: string | null;
  source_task_id: string;
  finding_key: string;
  title: string;
  description: string;
  severity: string;
  rule: string;
  location: string;
  message: string;
  recommended_action: string;
  acceptance_criteria_json: string;
  technical_notes: string;
  status: TaskFollowupProposalStatus;
  approved_task_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Input interfaces
// ---------------------------------------------------------------------------

export interface CreatePlanTaskInput {
  id: string;
  ordinal: number;
  title: string;
  description: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  technicalNotes: string;
}

export interface CreatePlanInput {
  id: string;
  projectPath: string;
  prdText: string;
  summary: string;
  technicalPack: import("@shared/types").TechnicalPack;
  tasks: CreatePlanTaskInput[];
}

// ---------------------------------------------------------------------------
// Row → domain-model mapper functions
// ---------------------------------------------------------------------------

export function mapPlanListRow(row: PlanListRow): PlanListItem {
  return {
    id: row.id,
    summary: row.summary,
    status: row.status,
    projectPath: row.project_path,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

export function mapTaskRow(row: TaskRow): RalphTask {
  return {
    id: row.id,
    planId: row.plan_id,
    ordinal: row.ordinal,
    title: row.title,
    description: row.description,
    dependencies: parseJsonArray(row.dependencies_json, "dependencies_json", row.id),
    acceptanceCriteria: parseJsonArray(
      row.acceptance_criteria_json,
      "acceptance_criteria_json",
      row.id,
    ),
    technicalNotes: row.technical_notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function mapRunRow(row: RunRow): TaskRun {
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
    errorText: row.error_text,
    retryCount: row.retry_count ?? 0,
  };
}

export function mapTaskFollowupProposalRow(row: TaskFollowupProposalRow): TaskFollowupProposal {
  return {
    id: row.id,
    planId: row.plan_id,
    sourceRunId: row.source_run_id,
    sourceTaskId: row.source_task_id,
    findingKey: row.finding_key,
    title: row.title,
    description: row.description,
    severity: row.severity,
    rule: row.rule,
    location: row.location,
    message: row.message,
    recommendedAction: row.recommended_action,
    acceptanceCriteria: parseJsonArray(
      row.acceptance_criteria_json,
      "acceptance_criteria_json",
      row.id,
    ),
    technicalNotes: row.technical_notes,
    status: row.status,
    approvedTaskId: row.approved_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
