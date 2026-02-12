export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
export type PlanStatus = "draft" | "ready" | "running" | "completed" | "failed";
export type RunStatus = "queued" | "in_progress" | "completed" | "failed" | "cancelled";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface TechnicalChecklistItem {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  technicalNotes: string;
}

export interface TechnicalPack {
  summary: string;
  architecture_notes: string[];
  files_expected: string[];
  dependencies: string[];
  risks: string[];
  assumptions: string[];
  acceptance_criteria: string[];
  test_strategy: string[];
  effort_estimate: string;
  checklist: TechnicalChecklistItem[];
}

export interface RalphTask {
  id: string;
  planId: string;
  ordinal: number;
  title: string;
  description: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  technicalNotes: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskRun {
  id: string;
  planId: string;
  taskId: string;
  sessionId: string | null;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  resultText: string | null;
  stopReason: string | null;
  errorText: string | null;
  retryCount: number;
}

export interface RalphPlan {
  id: string;
  projectPath: string;
  prdText: string;
  summary: string;
  technicalPack: TechnicalPack;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  tasks: RalphTask[];
  runs: TaskRun[];
}

/** Lightweight plan record returned by listPlans (no tasks, runs, or PRD body). */
export interface PlanListItem {
  id: string;
  summary: string;
  status: PlanStatus;
  projectPath: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface ProjectStackProfile {
  version: 1;
  updatedAt: string;
  specialistId: "stack-analyst";
  stackSummary: string;
  stackHints: string[];
  signals: string[];
  confidence: number;
}

export interface ProjectMemoryItem {
  projectId: string;
  projectKey: string;
  projectPath: string;
  displayName: string;
  metadata: Record<string, unknown>;
  stackProfile: ProjectStackProfile | null;
  createdAt: string;
  updatedAt: string;
  lastStackRefreshAt: string | null;
  recentPlans: PlanListItem[];
}

/** Filter options for listPlans. */
export interface ListPlansFilter {
  /** If true, return only archived plans. If false, return only non-archived. If undefined, return all. */
  archived?: boolean;
  /** Case-insensitive substring match against plan summary or project path. */
  search?: string;
}

export type RunEventType =
  | "started"
  | "log"
  | "todo_update"
  | "task_status"
  | "completed"
  | "failed"
  | "cancelled"
  | "info";

export interface RunEvent {
  id: string;
  ts: string;
  runId: string;
  planId: string;
  taskId: string;
  type: RunEventType;
  level: "info" | "error";
  payload: unknown;
}

export interface ListPlansInput {
  filter?: ListPlansFilter;
}

export interface ListProjectMemoryInput {
  search?: string;
  limitPlans?: number;
}

export interface RefreshProjectStackProfileInput {
  projectId: string;
}

export interface DeletePlanInput {
  planId: string;
}

export interface ArchivePlanInput {
  planId: string;
}

export interface UnarchivePlanInput {
  planId: string;
}

export interface CreatePlanInput {
  prdText: string;
  projectPath: string;
}

export interface CreatePlanResponse {
  planId: string;
}

export interface RunTaskInput {
  planId: string;
  taskId: string;
}

export interface RunTaskResponse {
  runId: string;
}

export interface RunAllInput {
  planId: string;
}

export interface RunAllResponse {
  queued: number;
}

export interface CancelRunInput {
  runId: string;
}

export interface CancelRunResponse {
  ok: boolean;
}

/** Input for retrying a failed task. */
export interface RetryTaskInput {
  planId: string;
  taskId: string;
}

/** Response from retrying a failed task. */
export interface RetryTaskResponse {
  runId: string;
}

/** Input for skipping a failed task. */
export interface SkipTaskInput {
  planId: string;
  taskId: string;
}

/** Input for aborting the queue for a plan. */
export interface AbortQueueInput {
  planId: string;
}

export type WizardStepId =
  | "context"
  | "goals"
  | "constraints"
  | "priorities"
  | "success"
  | "review";

export interface WizardStepData {
  stepId: WizardStepId;
  title: string;
  goal: string;
  currentData: string;
  note: string;
}

export interface GetWizardGuidanceInput {
  projectPath: string;
  draftPrompt: string;
  step: WizardStepData;
  allSteps: WizardStepData[];
}

export interface WizardGuidanceSuggestion {
  field: string;
  value: string;
  reason: string;
}

export interface WizardGuidanceResult {
  nextQuestion: string;
  recommendation: string;
  rationale: string;
  completenessScore: number;
  missingPoints: string[];
  promptFragment: string;
  suggestedEdits: WizardGuidanceSuggestion[];
}

export type ProjectMode = "existing" | "new";

export interface InferStackInput {
  projectMode: ProjectMode;
  projectPath: string;
  projectGoal: string;
  constraints: string;
  currentStack: string;
}

export interface StackAlternative {
  name: string;
  why: string;
  tradeoffs: string[];
}

export interface InferStackResult {
  recommendedStack: string;
  confidence: number;
  detectedSignals: string[];
  alternatives: StackAlternative[];
  followUpQuestions: string[];
  rationale: string;
}

export type DiscoveryQuestionType = "text" | "multiple_choice";

export interface DiscoveryQuestion {
  id: string;
  question: string;
  reason: string;
  /** Determines how the question is rendered in the UI. Always 'multiple_choice' for batched discovery. */
  question_type: DiscoveryQuestionType;
  /** Available options (4–5 items) for multiple-choice questions. */
  options: string[];
  /** AI-recommended best option (must match one of the options values exactly). */
  recommendedOption: string;
  /** Whether the user can pick one option ('single') or several ('multi'). */
  selectionMode: "single" | "multi";
}

export interface DiscoveryInferredContext {
  stack: string;
  documentation: string;
  scope: string;
  painPoints: string[];
  constraints: string[];
  signals: string[];
}

export interface DiscoveryAnswer {
  questionId: string;
  answer: string;
}

export interface StartDiscoveryInput {
  projectPath: string;
  seedSentence: string;
  additionalContext: string;
}

export interface ContinueDiscoveryInput {
  sessionId: string;
  answers: DiscoveryAnswer[];
}

export interface DiscoveryInterviewState {
  sessionId: string;
  round: number;
  directionSummary: string;
  inferredContext: DiscoveryInferredContext;
  questions: DiscoveryQuestion[];
  prdInputDraft: string;
  readinessScore: number;
  missingCriticalInfo: string[];
}

/** Status of a discovery session. */
export type DiscoverySessionStatus = "active" | "completed" | "abandoned";

/** Persisted discovery session record. */
export interface DiscoverySession {
  id: string;
  projectPath: string;
  seedSentence: string;
  additionalContext: string;
  answerHistory: DiscoveryAnswer[];
  roundNumber: number;
  latestState: DiscoveryInterviewState;
  status: DiscoverySessionStatus;
  createdAt: string;
  updatedAt: string;
}

export type DiscoveryEventType = "status" | "log" | "agent" | "completed" | "failed";

export interface DiscoveryEvent {
  id: string;
  ts: string;
  sessionId: string;
  type: DiscoveryEventType;
  level: "info" | "error";
  message: string;
  agent?: string;
  details?: string;
}

/** Agent roles stored in the model_config table. */
export type AgentRole =
  | "discovery_specialist"
  | "plan_synthesis"
  | "task_execution"
  | "tester"
  | "architecture_specialist"
  | "committer";

/** Model configuration entry returned by the backend. */
export interface ModelConfigEntry {
  id: string;
  agentRole: AgentRole;
  modelId: string;
  updatedAt: string;
}

/** Input for updating a model configuration entry. */
export interface UpdateModelConfigInput {
  agentRole: AgentRole;
  modelId: string;
}

/** Persisted application-level settings. */
export interface AppSettings {
  /** Optional Discord webhook URL for agent runtime notifications. Empty disables notifications. */
  discordWebhookUrl: string;
}

/** Input for updating persisted application settings. */
export interface UpdateAppSettingsInput {
  discordWebhookUrl: string;
}

/** Lightweight summary of a discovery session for the resume dialog. */
export interface DiscoverySessionSummary {
  id: string;
  projectPath: string;
  seedSentence: string;
  roundNumber: number;
  readinessScore: number;
  updatedAt: string;
}

/** Input for resuming a discovery session. */
export interface ResumeDiscoveryInput {
  sessionId: string;
}

/** Input for abandoning a discovery session. */
export interface AbandonDiscoveryInput {
  sessionId: string;
}

/** Input for cancelling an in-progress discovery session. */
export interface CancelDiscoveryInput {
  sessionId: string;
}

/** Response from cancelling an in-progress discovery session. */
export interface CancelDiscoveryResponse {
  ok: boolean;
}

/** Structured IPC error detail for a single Zod validation issue. */
export interface IpcZodIssue {
  path: (string | number)[];
  message: string;
  code?: string;
  expected?: string;
  received?: string;
}

/**
 * Structured IPC error sent from main process to renderer.
 * In development mode, includes detailed validation errors, stack traces,
 * and original error messages. In production, sanitized to a generic message.
 */
export interface IpcError {
  message: string;
  code: string;
  details?: IpcZodIssue[];
  stack?: string;
}

/** Input for fetching paginated run events. */
export interface GetRunEventsInput {
  runId: string;
  limit?: number;
  afterId?: string;
}

/** Response from fetching paginated run events. */
export interface GetRunEventsResponse {
  events: RunEvent[];
  hasMore: boolean;
}

export interface RalphApi {
  createPlan(input: CreatePlanInput): Promise<CreatePlanResponse>;
  getPlan(planId: string): Promise<RalphPlan | null>;
  listPlans(input: ListPlansInput): Promise<PlanListItem[]>;
  listProjectMemory(input: ListProjectMemoryInput): Promise<ProjectMemoryItem[]>;
  refreshProjectStackProfile(input: RefreshProjectStackProfileInput): Promise<ProjectMemoryItem>;
  deletePlan(input: DeletePlanInput): Promise<void>;
  archivePlan(input: ArchivePlanInput): Promise<void>;
  unarchivePlan(input: UnarchivePlanInput): Promise<void>;
  runTask(input: RunTaskInput): Promise<RunTaskResponse>;
  runAll(input: RunAllInput): Promise<RunAllResponse>;
  cancelRun(input: CancelRunInput): Promise<CancelRunResponse>;
  retryTask(input: RetryTaskInput): Promise<RetryTaskResponse>;
  skipTask(input: SkipTaskInput): Promise<void>;
  abortQueue(input: AbortQueueInput): Promise<void>;
  startDiscovery(input: StartDiscoveryInput): Promise<DiscoveryInterviewState>;
  continueDiscovery(input: ContinueDiscoveryInput): Promise<DiscoveryInterviewState>;
  getWizardGuidance(input: GetWizardGuidanceInput): Promise<WizardGuidanceResult>;
  inferStack(input: InferStackInput): Promise<InferStackResult>;
  getModelConfig(): Promise<ModelConfigEntry[]>;
  updateModelConfig(input: UpdateModelConfigInput): Promise<void>;
  getAppSettings(): Promise<AppSettings>;
  updateAppSettings(input: UpdateAppSettingsInput): Promise<void>;
  getDiscoverySessions(): Promise<DiscoverySessionSummary[]>;
  resumeDiscoverySession(input: ResumeDiscoveryInput): Promise<DiscoveryInterviewState>;
  abandonDiscoverySession(input: AbandonDiscoveryInput): Promise<void>;
  cancelDiscovery(input: CancelDiscoveryInput): Promise<CancelDiscoveryResponse>;
  getRunEvents(input: GetRunEventsInput): Promise<GetRunEventsResponse>;
  onDiscoveryEvent(handler: (event: DiscoveryEvent) => void): () => void;
  onRunEvent(handler: (event: RunEvent) => void): () => void;
}
