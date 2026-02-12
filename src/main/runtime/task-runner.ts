import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "@shared/ipc";
import type {
  AbortQueueInput,
  AgentRole,
  AppSettings,
  ApproveTaskProposalInput,
  ApproveTaskProposalResponse,
  CancelDiscoveryInput,
  CancelDiscoveryResponse,
  CancelRunInput,
  CancelRunResponse,
  ContinueDiscoveryInput,
  CreatePlanInput,
  CreatePlanResponse,
  DiscoveryAnswer,
  DiscoveryEvent,
  DiscoveryInterviewState,
  DiscoverySessionSummary,
  DismissTaskProposalInput,
  GetRunEventsResponse,
  GetWizardGuidanceInput,
  InferStackInput,
  ListProjectMemoryInput,
  ListPlansFilter,
  ModelConfigEntry,
  PlanListItem,
  ProjectMemoryItem,
  RalphPlan,
  RalphTask,
  RefreshProjectStackProfileInput,
  RetryTaskInput,
  RetryTaskResponse,
  RunAllInput,
  RunAllResponse,
  RunEvent,
  RunTaskInput,
  RunTaskResponse,
  SkipTaskInput,
  StartDiscoveryInput,
  TestDiscordWebhookInput,
  TestDiscordWebhookResult,
  TodoItem,
  UpdateAppSettingsInput
} from "@shared/types";
import { AppDatabase } from "./app-database";
import {
  RalphAgentService,
  type ModelConfigMap,
  type StackProfileStore
} from "./ralph-agent-service";

interface ActiveRun {
  interrupt?: () => Promise<void>;
  cancelRequested: boolean;
}

interface RunExecutionContext {
  workingDirectory?: string;
  branchName?: string;
  phaseNumber?: number;
}

interface QueueGitContext {
  repoRoot: string;
  mergeTargetBranch: string;
  originalBranch: string | null;
  worktreeRoot: string;
}

interface ArchitectureReviewFindingSnapshot {
  severity: string;
  location: string;
  rule: string;
  message: string;
  recommendedAction: string;
}

interface ArchitectureReviewSnapshot {
  status: string;
  summary: string;
  confidence: number;
  findings: ArchitectureReviewFindingSnapshot[];
}

interface PhaseWorktree {
  taskId: string;
  branchName: string;
  path: string;
  baseCommit: string;
}

interface DiscoverySession {
  id: string;
  projectPath: string;
  seedSentence: string;
  additionalContext: string;
  answerHistory: DiscoveryAnswer[];
  round: number;
  latestState: DiscoveryInterviewState | null;
}

interface DiscordNotificationField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordNotificationInput {
  speaker: string;
  title: string;
  description?: string;
  level?: "info" | "error";
  fields?: DiscordNotificationField[];
  footer?: string;
}

interface TaskRunnerOptions {
  subagentSpawnLogPath?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTaskId(raw: string, fallbackOrdinal: number): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (cleaned.length > 0) {
    return cleaned;
  }

  return `task-${fallbackOrdinal}`;
}

/** Maximum number of retries allowed for a single task. Configurable at build time. */
const MAX_RETRIES = 3;

/** Default timeout (ms) to wait for SDK interrupt before force-cancelling a run. */
const CANCEL_TIMEOUT_MS = 10_000;

/** Maximum time (ms) a queue task run may remain active before forced cancellation. */
const QUEUE_RUN_TIMEOUT_MS = (() => {
  const raw = process.env.RALPH_QUEUE_RUN_TIMEOUT_MS;
  if (!raw) {
    return 45 * 60 * 1000; // 45 minutes
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 45 * 60 * 1000;
  }
  return parsed;
})();

/** Stale run threshold: runs in_progress for longer than this (ms) with no active tracking are cleaned up. */
const STALE_RUN_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const CONVENTIONAL_COMMIT_HEADER = /^[a-z]+(?:\([^)]+\))?!?: .+/;
const CLAUDE_COAUTHOR_TRAILER = /co-authored-by:\s*.*claude/i;

export class TaskRunner {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly runCompletion = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  private readonly runningPlanQueues = new Set<string>();
  private readonly abortedPlanQueues = new Set<string>();
  private readonly discoverySessions = new Map<string, DiscoverySession>();
  /** Set of discovery session IDs that have been cancelled. Checked between analysis-agent completions and before synthesis. */
  private readonly cancelledDiscoveries = new Set<string>();
  private agentService: RalphAgentService;

  constructor(
    private readonly db: AppDatabase,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly options: TaskRunnerOptions = {}
  ) {
    this.agentService = this.createAgentService();
    this.cleanupStaleRuns();
  }

  private async writeSubagentSpawnLog(input: {
    runId: string;
    planId: string;
    taskId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const logPath = this.options.subagentSpawnLogPath?.trim();
    if (!logPath) {
      return;
    }

    const subagentType =
      typeof input.payload.subagent_type === "string" && input.payload.subagent_type.trim().length > 0
        ? input.payload.subagent_type.trim()
        : "unknown";
    const stage =
      typeof input.payload.stage === "string" && input.payload.stage.trim().length > 0
        ? input.payload.stage.trim()
        : "unknown";
    const description = typeof input.payload.description === "string" ? input.payload.description : "";
    const prompt = typeof input.payload.prompt === "string" ? input.payload.prompt : "";

    const entry =
      `[${nowIso()}] run=${input.runId} plan=${input.planId} task=${input.taskId} stage=${stage} ` +
      `subagent=${subagentType} description=${JSON.stringify(description)}\n` +
      "[prompt-begin]\n" +
      `${prompt}\n` +
      "[prompt-end]\n\n";

    try {
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, entry, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[TaskRunner] Failed to append subagent spawn log at ${logPath}: ${message}`);
    }
  }

  /**
   * Build a ModelConfigMap from the current model_config DB rows.
   * Used at construction time and can be refreshed via refreshModelConfig().
   */
  private buildModelConfigMap(): ModelConfigMap {
    const entries = this.db.getModelConfig();
    const map: ModelConfigMap = new Map();
    for (const entry of entries) {
      map.set(entry.agentRole, entry.modelId);
    }
    return map;
  }

  private buildStackProfileStore(): StackProfileStore {
    return {
      read: (projectPath: string) => this.db.getProjectStackProfile(projectPath),
      write: (projectPath: string, profile) => this.db.upsertProjectStackProfile(projectPath, profile)
    };
  }

  private createAgentService(): RalphAgentService {
    return new RalphAgentService(this.buildModelConfigMap(), this.buildStackProfileStore());
  }

  private buildProjectHistoryContext(projectPath: string): string {
    const history = this.db.listPlansByProject(projectPath, 8);
    if (history.length === 0) {
      return "";
    }

    const lines = history.map(
      (plan, index) =>
        `${index + 1}. [${plan.status}] ${plan.summary} (id=${plan.id}, created=${plan.createdAt})`
    );

    return [
      "Project memory (recent plans for the same project path):",
      ...lines,
      "Use this history to avoid redundant plans and preserve continuity."
    ].join("\n");
  }

  private buildPlanProgressContext(planId: string, limit = 10): string {
    const entries = this.db.listPlanProgressEntries(planId, limit);
    if (entries.length === 0) {
      return "No prior progress entries have been recorded for this plan.";
    }

    const lines = entries.map((entry, index) => {
      const source = entry.runId ? `run=${entry.runId}` : "run=none";
      const normalized = entry.entryText.replace(/\s+/g, " ").trim();
      const summary = normalized.length > 1000 ? `${normalized.slice(0, 997)}...` : normalized;
      return `${index + 1}. [${entry.status}] ${entry.createdAt} (${source}) ${summary}`;
    });

    return ["Plan progress history (most recent first):", ...lines].join("\n");
  }

  private composeDiscoveryAdditionalContext(
    userAdditionalContext: string,
    projectPath: string
  ): string {
    const blocks: string[] = [];
    const trimmed = userAdditionalContext.trim();
    if (trimmed.length > 0) {
      blocks.push(trimmed);
    }

    const projectHistory = this.buildProjectHistoryContext(projectPath);
    if (projectHistory.length > 0) {
      blocks.push(projectHistory);
    }

    return blocks.join("\n\n");
  }

  /**
   * Rebuild the agent service with fresh model configuration from the database.
   * Called after model config changes so subsequent SDK calls use updated models.
   */
  refreshModelConfig(): void {
    const newService = this.createAgentService();
    this.agentService = newService;
  }

  getPlan(planId: string): RalphPlan | null {
    return this.db.getPlan(planId);
  }

  listPlans(filter?: ListPlansFilter): PlanListItem[] {
    return this.db.listPlans(filter);
  }

  listProjectMemory(input: ListProjectMemoryInput = {}): ProjectMemoryItem[] {
    return this.db.listProjectMemory(input);
  }

  async refreshProjectStackProfile(input: RefreshProjectStackProfileInput): Promise<ProjectMemoryItem> {
    const project = this.db.getProjectMemoryItemById(input.projectId, 8);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const refreshedProfile = await this.agentService.refreshStackProfile({
      projectPath: project.projectPath,
      additionalContext: "Manual refresh requested from Project Memory view."
    });

    this.db.upsertProjectStackProfile(project.projectPath, refreshedProfile);

    const updated = this.db.getProjectMemoryItemById(input.projectId, 8);
    if (!updated) {
      throw new Error(`Project memory not found after refresh: ${input.projectId}`);
    }

    return updated;
  }

  deletePlan(planId: string): void {
    this.db.deletePlan(planId);
  }

  archivePlan(planId: string): void {
    this.db.archivePlan(planId);
  }

  unarchivePlan(planId: string): void {
    this.db.unarchivePlan(planId);
  }

  getRunEvents(
    runId: string,
    options: { limit?: number; afterId?: string } = {}
  ): GetRunEventsResponse {
    return this.db.getRunEvents(runId, options);
  }

  getModelConfig(): ModelConfigEntry[] {
    return this.db.getModelConfig();
  }

  updateModelForRole(role: AgentRole, modelId: string): void {
    this.db.updateModelForRole(role, modelId);
    this.refreshModelConfig();
  }

  getAppSettings(): AppSettings {
    return this.db.getAppSettings();
  }

  updateAppSettings(input: UpdateAppSettingsInput): void {
    this.db.updateAppSettings(input);
  }

  /**
   * Send a test embed to the given Discord webhook URL.
   * Returns { ok: true } on success, or { ok: false, error } on failure.
   */
  async testDiscordWebhook(input: TestDiscordWebhookInput): Promise<TestDiscordWebhookResult> {
    const { webhookUrl } = input;

    if (typeof fetch !== "function") {
      return { ok: false, error: "Global fetch is unavailable in this environment." };
    }

    const payload = this.buildDiscordPayload({
      speaker: "Ralph",
      title: "\u2705 Webhook Test Successful",
      description:
        "This is a test notification from **Ralph Desktop**. " +
        "If you can see this message, your Discord webhook is configured correctly!",
      level: "info",
      fields: [
        { name: "Status", value: "Connected", inline: true },
        { name: "Sent At", value: new Date().toLocaleString(), inline: true }
      ],
      footer: "Ralph Desktop \u2014 Test Notification"
    });

    // Override the default info color with green/teal per task spec
    if (Array.isArray(payload.embeds)) {
      const embed = payload.embeds[0] as Record<string, unknown> | undefined;
      if (embed) {
        embed.color = 0x10b981;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          error: `Discord returned HTTP ${response.status}: ${body.slice(0, 180)}`
        };
      }

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async startDiscovery(input: StartDiscoveryInput): Promise<DiscoveryInterviewState> {
    const sessionId = randomUUID();
    const session: DiscoverySession = {
      id: sessionId,
      projectPath: input.projectPath,
      seedSentence: input.seedSentence,
      additionalContext: input.additionalContext,
      answerHistory: [],
      round: 0,
      latestState: null
    };

    this.discoverySessions.set(sessionId, session);
    this.emitDiscoveryEvent({
      sessionId,
      type: "status",
      level: "info",
      message: "Discovery started. Spawning dynamic analysis agents..."
    });

    try {
      const discoveryAdditionalContext = this.composeDiscoveryAdditionalContext(
        input.additionalContext,
        input.projectPath
      );
      const initialState = await this.agentService.startDiscovery({
        projectPath: input.projectPath,
        seedSentence: input.seedSentence,
        additionalContext: discoveryAdditionalContext,
        callbacks: {
          onEvent: (event) => {
            this.emitDiscoveryEvent({
              sessionId,
              type: event.type,
              level: event.level,
              message: event.message,
              agent: event.agent,
              details: event.details
            });
          }
        }
      });

      // Check if cancelled while the discovery was running
      this.checkDiscoveryCancelled(sessionId);

      session.round = 1;

      const fullState: DiscoveryInterviewState = {
        sessionId,
        round: session.round,
        ...initialState
      };
      session.latestState = fullState;

      // Persist session to database
      this.db.createDiscoverySession({
        id: sessionId,
        projectPath: input.projectPath,
        seedSentence: input.seedSentence,
        additionalContext: input.additionalContext,
        latestState: fullState
      });

      this.emitDiscoveryEvent({
        sessionId,
        type: "completed",
        level: "info",
        message: `Discovery round 1 completed. Readiness ${initialState.readinessScore}%.`
      });

      return fullState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discovery start failed.";
      // Only emit failure event if not already emitted by cancelDiscovery
      if (!this.cancelledDiscoveries.has(sessionId)) {
        this.emitDiscoveryEvent({
          sessionId,
          type: "failed",
          level: "error",
          message
        });
      }
      this.cancelledDiscoveries.delete(sessionId);
      this.discoverySessions.delete(sessionId);
      throw error;
    }
  }

  async continueDiscovery(input: ContinueDiscoveryInput): Promise<DiscoveryInterviewState> {
    const session = this.discoverySessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Discovery session not found: ${input.sessionId}`);
    }

    session.answerHistory.push(
      ...input.answers.map((answer) => ({
        questionId: answer.questionId,
        answer: answer.answer
      }))
    );

    this.emitDiscoveryEvent({
      sessionId: session.id,
      type: "status",
      level: "info",
      message: "Processing your answers and refining PRD direction..."
    });

    try {
      const discoveryAdditionalContext = this.composeDiscoveryAdditionalContext(
        session.additionalContext,
        session.projectPath
      );
      const nextState = await this.agentService.continueDiscovery({
        projectPath: session.projectPath,
        seedSentence: session.seedSentence,
        additionalContext: discoveryAdditionalContext,
        stackRefreshContext: session.additionalContext,
        answerHistory: session.answerHistory,
        latestAnswers: input.answers,
        previousState: session.latestState,
        callbacks: {
          onEvent: (event) => {
            this.emitDiscoveryEvent({
              sessionId: session.id,
              type: event.type,
              level: event.level,
              message: event.message,
              agent: event.agent,
              details: event.details
            });
          }
        }
      });

      // Check if cancelled while the discovery was running
      this.checkDiscoveryCancelled(session.id);

      session.round += 1;

      const fullState: DiscoveryInterviewState = {
        sessionId: session.id,
        round: session.round,
        ...nextState
      };
      session.latestState = fullState;

      // Persist updated session state to database
      this.db.updateDiscoverySession({
        id: session.id,
        answerHistory: session.answerHistory,
        roundNumber: session.round,
        latestState: fullState
      });

      this.emitDiscoveryEvent({
        sessionId: session.id,
        type: "completed",
        level: "info",
        message: `Discovery round ${session.round} completed. Readiness ${nextState.readinessScore}%.`
      });

      return fullState;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discovery continue failed.";
      // Only emit failure event if not already emitted by cancelDiscovery
      if (!this.cancelledDiscoveries.has(session.id)) {
        this.emitDiscoveryEvent({
          sessionId: session.id,
          type: "failed",
          level: "error",
          message
        });
      }
      this.cancelledDiscoveries.delete(session.id);
      throw error;
    }
  }

  /**
   * Return lightweight summaries of all active discovery sessions.
   */
  getActiveDiscoverySessions(): DiscoverySessionSummary[] {
    const sessions = this.db.getActiveDiscoverySessions();
    return sessions.map((session) => ({
      id: session.id,
      projectPath: session.projectPath,
      seedSentence: session.seedSentence,
      roundNumber: session.roundNumber,
      readinessScore: session.latestState.readinessScore,
      updatedAt: session.updatedAt
    }));
  }

  /**
   * Resume a persisted discovery session by ID.
   * Hydrates the in-memory DiscoverySession map from DB state and returns
   * the latest DiscoveryInterviewState so the renderer can restore the UI.
   */
  resumeDiscoverySession(sessionId: string): DiscoveryInterviewState {
    const dbSession = this.db.getDiscoverySession(sessionId);
    if (!dbSession) {
      throw new Error(`Discovery session not found: ${sessionId}`);
    }
    if (dbSession.status !== "active") {
      throw new Error(`Discovery session is not active: ${sessionId} (status: ${dbSession.status})`);
    }

    // Hydrate in-memory session so continueDiscovery() works
    this.discoverySessions.set(sessionId, {
      id: sessionId,
      projectPath: dbSession.projectPath,
      seedSentence: dbSession.seedSentence,
      additionalContext: dbSession.additionalContext,
      answerHistory: dbSession.answerHistory,
      round: dbSession.roundNumber,
      latestState: dbSession.latestState
    });

    return dbSession.latestState;
  }

  /**
   * Abandon (soft-delete) a discovery session by ID.
   * Removes it from the in-memory map and marks it as 'abandoned' in the DB.
   */
  abandonDiscoverySession(sessionId: string): void {
    this.discoverySessions.delete(sessionId);
    this.db.abandonDiscoverySession(sessionId);
  }

  /**
   * Cancel an in-progress discovery session.
   * Sets a cancelled flag that is checked between specialist completions
   * and before synthesis. If a specialist query is mid-flight it may
   * complete but its result will be discarded.
   */
  cancelDiscovery(input: CancelDiscoveryInput): CancelDiscoveryResponse {
    const session = this.discoverySessions.get(input.sessionId);
    if (!session) {
      // Session might not exist yet (race) or already completed
      return { ok: false };
    }

    this.cancelledDiscoveries.add(input.sessionId);

    this.emitDiscoveryEvent({
      sessionId: input.sessionId,
      type: "failed",
      level: "info",
      message: "Discovery cancelled by user."
    });

    return { ok: true };
  }

  /**
   * Check whether a discovery session has been cancelled.
   * If so, clean up the in-memory session and throw a cancellation error
   * to abort the current discovery flow.
   */
  private checkDiscoveryCancelled(sessionId: string): void {
    if (this.cancelledDiscoveries.has(sessionId)) {
      this.cancelledDiscoveries.delete(sessionId);
      this.discoverySessions.delete(sessionId);
      throw new Error("Discovery cancelled by user.");
    }
  }

  async getWizardGuidance(input: GetWizardGuidanceInput) {
    return await this.agentService.getWizardGuidance(input);
  }

  async inferStack(input: InferStackInput) {
    return await this.agentService.inferStack(input);
  }

  async createPlan(input: CreatePlanInput): Promise<CreatePlanResponse> {
    void this.postDiscordNotification(
      {
        speaker: this.displayRoleLabel("plan_synthesis"),
        title: "Creating Plan",
        description: "Generating technical plan from PRD input.",
        level: "info",
        fields: [
          {
            name: "Project Path",
            value: input.projectPath || "(none provided)"
          }
        ]
      }
    );

    let planResult: Awaited<ReturnType<RalphAgentService["createPlan"]>>;
    try {
      const projectHistoryContext = this.buildProjectHistoryContext(input.projectPath);
      planResult = await this.agentService.createPlan({
        projectPath: input.projectPath,
        prdText: input.prdText,
        projectHistoryContext
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.postDiscordNotification(
        {
          speaker: this.displayRoleLabel("plan_synthesis"),
          title: "Plan Creation Failed",
          description: this.truncateForDiscord(message, 800),
          level: "error"
        }
      );
      throw error;
    }

    const planId = randomUUID();

    const normalizedIds = new Set<string>();
    const taskIdMap = new Map<string, string>();

    const tasks = planResult.technicalPack.checklist.map((item, index) => {
      const baseId = normalizeTaskId(item.id, index + 1);
      let candidate = baseId;
      let offset = 2;

      while (normalizedIds.has(candidate)) {
        candidate = `${baseId}-${offset}`;
        offset += 1;
      }

      const scopedId = `${planId}-${candidate}`;
      normalizedIds.add(scopedId);
      taskIdMap.set(item.id, scopedId);

      return {
        id: scopedId,
        ordinal: index + 1,
        title: item.title,
        description: item.description,
        dependencies: item.dependencies,
        acceptanceCriteria: item.acceptanceCriteria,
        technicalNotes: item.technicalNotes
      };
    });

    for (const task of tasks) {
      task.dependencies = task.dependencies
        .map((dependencyId) => {
          const mapped = taskIdMap.get(dependencyId);
          if (mapped) {
            return mapped;
          }

          const normalizedDependency = normalizeTaskId(dependencyId, task.ordinal);
          return `${planId}-${normalizedDependency}`;
        })
        .filter((dependencyId) => normalizedIds.has(dependencyId) && dependencyId !== task.id);
    }

    this.db.createPlan({
      id: planId,
      projectPath: input.projectPath,
      prdText: input.prdText,
      summary: planResult.summary,
      technicalPack: planResult.technicalPack,
      tasks
    });

    void this.postDiscordNotification(
      {
        speaker: this.displayRoleLabel("plan_synthesis"),
        title: "Plan Created",
        description: this.truncateForDiscord(planResult.summary, 1200),
        level: "info",
        fields: [
          { name: "Plan ID", value: planId, inline: true },
          { name: "Tasks", value: String(tasks.length), inline: true }
        ]
      }
    );

    return { planId };
  }

  async runTask(input: RunTaskInput): Promise<RunTaskResponse> {
    return await this.startTaskExecution({
      planId: input.planId,
      taskId: input.taskId,
      startedMessage: "Task execution started."
    });
  }

  private async startTaskExecution(input: {
    planId: string;
    taskId: string;
    startedMessage: string;
    retryCount?: number;
    retryContext?: { retryCount: number; previousError: string };
    executionContext?: RunExecutionContext;
  }): Promise<RunTaskResponse> {
    const plan = this.db.getPlan(input.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${input.planId}`);
    }

    const task = plan.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    const runId = randomUUID();

    this.db.createRun({
      id: runId,
      planId: input.planId,
      taskId: input.taskId,
      status: "in_progress",
      retryCount: input.retryCount
    });

    this.db.updateTaskStatus(input.taskId, "in_progress");
    this.db.updatePlanStatus(input.planId, "running");

    this.emitEvent({
      runId,
      planId: input.planId,
      taskId: input.taskId,
      type: "started",
      level: "info",
      payload: {
        message: input.startedMessage,
        taskTitle: task.title,
        retryCount: input.retryCount ?? 0,
        phaseNumber: input.executionContext?.phaseNumber ?? null,
        branchName: input.executionContext?.branchName ?? null
      }
    });

    this.emitEvent({
      runId,
      planId: input.planId,
      taskId: input.taskId,
      type: "task_status",
      level: "info",
      payload: {
        status: "in_progress"
      }
    });

    let resolveRun: () => void = () => undefined;
    const completionPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    this.runCompletion.set(runId, { promise: completionPromise, resolve: resolveRun });
    this.activeRuns.set(runId, { cancelRequested: false });

    void this.executeRun({
      runId,
      plan,
      task,
      retryContext: input.retryContext,
      executionContext: input.executionContext
    });

    return { runId };
  }

  async runAll(input: RunAllInput): Promise<RunAllResponse> {
    if (this.runningPlanQueues.has(input.planId)) {
      const reason = "Queue is already running for this plan.";
      this.emitQueueInfo(input.planId, reason);
      return {
        queued: 0,
        reason
      };
    }

    const plan = this.db.getPlan(input.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${input.planId}`);
    }

    const inProgressRuns = plan.runs.filter((run) => run.status === "in_progress");
    const trackedActiveRuns = inProgressRuns.filter((run) => this.activeRuns.has(run.id));
    const orphanedRuns = inProgressRuns.filter((run) => !this.activeRuns.has(run.id));

    if (trackedActiveRuns.length > 0) {
      const reason =
        "A task run is already in progress. Wait for it to finish or cancel it before starting the queue.";
      this.emitQueueInfo(
        input.planId,
        reason,
        "error"
      );
      return {
        queued: 0,
        reason
      };
    }

    if (orphanedRuns.length > 0) {
      for (const run of orphanedRuns) {
        this.db.updateRun({
          runId: run.id,
          status: "cancelled",
          endedAt: nowIso(),
          errorText: "Cancelled (recovered orphaned in-progress run before queue start)"
        });
        this.db.updateTaskStatus(run.taskId, "pending");
      }
      this.db.updatePlanStatus(input.planId, "ready");
      this.emitQueueInfo(
        input.planId,
        `Recovered ${orphanedRuns.length} orphaned in-progress run(s) before starting queue.`
      );
    }

    const estimated = this.db.countRunnableTasks(input.planId);
    if (estimated === 0) {
      const reason = "No runnable pending tasks available for queue start.";
      this.emitQueueInfo(input.planId, reason);
      return {
        queued: 0,
        reason
      };
    }

    this.runningPlanQueues.add(input.planId);

    let gitContext: QueueGitContext;
    try {
      gitContext = await this.prepareQueueGitContext(plan);
    } catch (error) {
      this.runningPlanQueues.delete(input.planId);
      const message = error instanceof Error ? error.message : "Unknown queue startup failure.";
      this.db.updatePlanStatus(input.planId, "failed");
      const reason = `Queue execution failed: ${message}`;
      this.emitQueueInfo(input.planId, reason, "error");
      return {
        queued: 0,
        reason
      };
    }

    void this.executeQueue(input.planId, gitContext).finally(() => {
      this.runningPlanQueues.delete(input.planId);
    });

    return {
      queued: estimated
    };
  }

  async cancelRun(input: CancelRunInput): Promise<CancelRunResponse> {
    const active = this.activeRuns.get(input.runId);
    if (!active) {
      return { ok: false };
    }

    active.cancelRequested = true;

    // If we have an interrupt handle, race it against a timeout
    if (active.interrupt) {
      const interruptPromise = active.interrupt().catch(() => {
        // SDK interrupt failed; the timeout will handle force-cancel
      });

      const timeoutPromise = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), CANCEL_TIMEOUT_MS);
      });

      const result = await Promise.race([
        interruptPromise.then(() => "interrupted" as const),
        timeoutPromise
      ]);

      if (result === "timeout") {
        // SDK did not respond within timeout -- force-cancel
        this.forceCancelRun(input.runId);
      }
    } else {
      // No interrupt handle available -- force-cancel immediately
      this.forceCancelRun(input.runId);
    }

    return { ok: true };
  }

  /**
   * Force-cancel a run by directly updating the DB record and cleaning up
   * the in-memory activeRuns map.  Called when the SDK doesn't respond to
   * interrupt within the configured timeout.
   */
  private forceCancelRun(runId: string): void {
    const runRecord = this.db.getRun(runId);

    // Only force-cancel if the run is still in_progress (not already finalized by executeRun)
    if (runRecord && runRecord.status === "in_progress") {
      this.db.updateRun({
        runId,
        status: "cancelled",
        endedAt: nowIso(),
        errorText: "Cancelled (forced after timeout)"
      });

      // Reset the task status back to pending so it can be re-run
      this.db.updateTaskStatus(runRecord.taskId, "pending");

      // Update plan status
      this.db.updatePlanStatus(runRecord.planId, "ready");

      this.emitEvent({
        runId,
        planId: runRecord.planId,
        taskId: runRecord.taskId,
        type: "cancelled",
        level: "info",
        payload: {
          message: "Run cancelled (forced after timeout)."
        }
      });
    }

    // Clean up in-memory tracking
    this.activeRuns.delete(runId);
    const completion = this.runCompletion.get(runId);
    completion?.resolve();
    this.runCompletion.delete(runId);
  }

  /**
   * Clean up stale runs on initialization.
   * Finds runs marked as in_progress in the DB that are older than STALE_RUN_THRESHOLD_MS
   * and have no corresponding entry in the activeRuns map (indicating they were orphaned
   * by a previous app session). Marks them as cancelled with an explanatory error.
   */
  private cleanupStaleRuns(): void {
    const threshold = new Date(Date.now() - STALE_RUN_THRESHOLD_MS).toISOString();
    const staleRuns = this.db.getStaleInProgressRuns(threshold);

    for (const run of staleRuns) {
      // Only clean up runs that are NOT tracked in-memory (should be all at startup)
      if (!this.activeRuns.has(run.id)) {
        console.warn(`[TaskRunner] Cleaning up stale run ${run.id} (started ${run.startedAt})`);

        this.db.updateRun({
          runId: run.id,
          status: "cancelled",
          endedAt: nowIso(),
          errorText: "Cancelled (stale run cleaned up on startup)"
        });

        this.db.updateTaskStatus(run.taskId, "pending");
        this.db.updatePlanStatus(run.planId, "ready");
      }
    }

    if (staleRuns.length > 0) {
      console.info(`[TaskRunner] Cleaned up ${staleRuns.length} stale run(s) from previous session.`);
    }
  }

  /**
   * Retry a failed task by creating a new run with retry context.
   * Injects the previous error into the prompt so the agent can take a different approach.
   * Max retries are configurable (default: 3).
   */
  async retryTask(input: RetryTaskInput): Promise<RetryTaskResponse> {
    const plan = this.db.getPlan(input.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${input.planId}`);
    }

    const task = plan.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    if (task.status !== "failed") {
      throw new Error(`Task ${input.taskId} is not in a failed state (current: ${task.status}). Only failed tasks can be retried.`);
    }

    const failedRun = this.db.getLatestFailedRun(input.planId, input.taskId);
    const previousRetryCount = failedRun?.retryCount ?? 0;
    const newRetryCount = previousRetryCount + 1;

    if (newRetryCount > MAX_RETRIES) {
      throw new Error(`Task ${input.taskId} has reached the maximum retry limit (${MAX_RETRIES}). Consider skipping this task or adjusting the approach manually.`);
    }

    const previousError = failedRun?.errorText ?? "Unknown error from previous attempt.";
    return await this.startTaskExecution({
      planId: input.planId,
      taskId: input.taskId,
      startedMessage: `Task retry #${newRetryCount} started.`,
      retryCount: newRetryCount,
      retryContext: {
        retryCount: newRetryCount,
        previousError
      }
    });
  }

  /**
   * Skip a failed task: marks the task as 'skipped' so the queue can continue
   * past it. Downstream dependencies treat 'skipped' as satisfied.
   */
  skipTask(input: SkipTaskInput): void {
    const plan = this.db.getPlan(input.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${input.planId}`);
    }

    const task = plan.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    if (task.status !== "failed") {
      throw new Error(`Task ${input.taskId} is not in a failed state (current: ${task.status}). Only failed tasks can be skipped.`);
    }

    this.db.updateTaskStatus(input.taskId, "skipped");

    // Update plan status: if all tasks are completed or skipped, mark plan as completed
    const allTasks = this.db.getTasks(input.planId);
    const allDone = allTasks.every((t) => t.status === "completed" || t.status === "skipped");
    if (allDone) {
      this.db.updatePlanStatus(input.planId, "completed");
    } else {
      this.db.updatePlanStatus(input.planId, "ready");
    }

    this.emitEvent({
      runId: "",
      planId: input.planId,
      taskId: input.taskId,
      type: "task_status",
      level: "info",
      payload: {
        status: "skipped",
        message: `Task ${input.taskId} skipped by user.`
      }
    });
  }

  approveTaskProposal(input: ApproveTaskProposalInput): ApproveTaskProposalResponse {
    const plan = this.db.getPlan(input.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${input.planId}`);
    }

    const result = this.db.approveTaskFollowupProposal({
      planId: input.planId,
      proposalId: input.proposalId
    });
    if (!result) {
      throw new Error(`Follow-up proposal not found or already processed: ${input.proposalId}`);
    }

    const latestPlan = this.db.getPlan(input.planId);
    if (latestPlan && (latestPlan.status === "completed" || latestPlan.status === "failed")) {
      this.db.updatePlanStatus(input.planId, "ready");
    }

    this.emitEvent({
      runId: "",
      planId: input.planId,
      taskId: result.taskId,
      type: "info",
      level: "info",
      payload: {
        message: `Approved follow-up proposal and created task ${result.taskId}.`,
        proposalId: input.proposalId,
        taskId: result.taskId
      }
    });

    return { taskId: result.taskId };
  }

  dismissTaskProposal(input: DismissTaskProposalInput): void {
    const plan = this.db.getPlan(input.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${input.planId}`);
    }

    const changed = this.db.dismissTaskFollowupProposal({
      planId: input.planId,
      proposalId: input.proposalId
    });
    if (!changed) {
      throw new Error(`Follow-up proposal not found or already processed: ${input.proposalId}`);
    }

    this.emitEvent({
      runId: "",
      planId: input.planId,
      taskId: "",
      type: "info",
      level: "info",
      payload: {
        message: "Follow-up proposal dismissed.",
        proposalId: input.proposalId
      }
    });
  }

  /**
   * Abort queue execution for a plan.
   * Stops the current queue loop and marks remaining queued tasks as pending.
   * If there is an active run in the queue, it is cancelled.
   */
  abortQueue(input: AbortQueueInput): void {
    if (!this.runningPlanQueues.has(input.planId)) {
      return;
    }

    // Signal the queue loop to stop
    this.abortedPlanQueues.add(input.planId);

    // Cancel any active run belonging to this plan
    for (const [runId, active] of this.activeRuns) {
      const runRecord = this.db.getRun(runId);
      if (runRecord && runRecord.planId === input.planId && !active.cancelRequested) {
        active.cancelRequested = true;
        if (active.interrupt) {
          void active.interrupt();
        }
      }
    }

    // Update plan status to ready
    this.db.updatePlanStatus(input.planId, "ready");

    this.emitEvent({
      runId: "",
      planId: input.planId,
      taskId: "",
      type: "info",
      level: "info",
      payload: {
        message: "Queue execution aborted by user."
      }
    });
  }

  private getRunnablePhaseTasks(planId: string): RalphTask[] {
    const tasks = this.db.getTasks(planId);
    const statusById = new Map(tasks.map((task) => [task.id, task.status]));

    return tasks.filter((task) => {
      if (task.status !== "pending") {
        return false;
      }

      return task.dependencies.every((dependencyId) => {
        const dependencyStatus = statusById.get(dependencyId);
        return dependencyStatus === "completed" || dependencyStatus === "skipped";
      });
    });
  }

  private emitQueueInfo(planId: string, message: string, level: "info" | "error" = "info"): void {
    this.emitEvent({
      runId: "",
      planId,
      taskId: "",
      type: "info",
      level,
      payload: {
        message
      }
    });
  }

  private async executeQueue(planId: string, initialGitContext?: QueueGitContext): Promise<void> {
    let gitContext: QueueGitContext | null = initialGitContext ?? null;

    try {
      const plan = this.db.getPlan(planId);
      if (!plan) {
        throw new Error(`Plan not found: ${planId}`);
      }

      if (!gitContext) {
        gitContext = await this.prepareQueueGitContext(plan);
      }
      if (gitContext.mergeTargetBranch !== "main") {
        this.emitQueueInfo(
          planId,
          `Branch "main" not found. Using "${gitContext.mergeTargetBranch}" as merge target for this queue.`
        );
      }

      this.emitQueueInfo(
        planId,
        `Queue started. Runnable phases execute in parallel worktrees and merge into ${gitContext.mergeTargetBranch} after each phase.`
      );

      let phaseNumber = 0;

      while (true) {
        if (this.abortedPlanQueues.has(planId)) {
          break;
        }

        const phaseTasks = this.getRunnablePhaseTasks(planId);
        if (phaseTasks.length === 0) {
          break;
        }

        phaseNumber += 1;
        this.emitQueueInfo(
          planId,
          `Starting phase ${phaseNumber} with ${phaseTasks.length} parallel task(s).`
        );

        const phaseWorktrees = await this.createPhaseWorktrees(plan, phaseNumber, phaseTasks, gitContext);
        const worktreeByTaskId = new Map(phaseWorktrees.map((worktree) => [worktree.taskId, worktree]));
        const worktreeByRunId = new Map<string, PhaseWorktree>();
        const unmergedWorktrees = new Map(phaseWorktrees.map((worktree) => [worktree.taskId, worktree]));
        const phaseRuns: Array<{ runId: string; taskId: string }> = [];
        const activeRunIds = new Set<string>();
        let phaseFailed = false;

        try {
          for (const task of phaseTasks) {
            const worktree = worktreeByTaskId.get(task.id);
            if (!worktree) {
              throw new Error(`Missing worktree context for task ${task.id}.`);
            }

            const run = await this.startTaskExecution({
              planId,
              taskId: task.id,
              startedMessage: `Task execution started in phase ${phaseNumber}.`,
              executionContext: {
                workingDirectory: worktree.path,
                branchName: worktree.branchName,
                phaseNumber
              }
            });

            phaseRuns.push({
              runId: run.runId,
              taskId: task.id
            });
            worktreeByRunId.set(run.runId, worktree);
            activeRunIds.add(run.runId);
          }
        } catch (error) {
          if (phaseRuns.length > 0) {
            await Promise.all(
              phaseRuns.map(async (run) => {
                await this.cancelRun({ runId: run.runId }).catch(() => ({ ok: false }));
                await this.waitForRun(run.runId);
              })
            );
          }

          await this.cleanupPhaseWorktrees(gitContext, phaseWorktrees, false);
          throw error;
        }

        while (activeRunIds.size > 0) {
          if (this.abortedPlanQueues.has(planId)) {
            await Promise.all(
              [...activeRunIds].map(async (runId) => {
                await this.cancelRun({ runId }).catch(() => ({ ok: false }));
                await this.waitForRun(runId);
              })
            );
            activeRunIds.clear();
            await this.cleanupPhaseWorktrees(gitContext, [...unmergedWorktrees.values()], false);
            break;
          }

          const completedRunId = await Promise.race(
            [...activeRunIds].map(async (runId) => {
              await this.waitForRun(runId);
              return runId;
            })
          );

          activeRunIds.delete(completedRunId);
          const runState = this.db.getRun(completedRunId);
          const completedWorktree = worktreeByRunId.get(completedRunId);

          if (!completedWorktree) {
            throw new Error(`Missing worktree metadata for completed run ${completedRunId}.`);
          }

          if (!runState || runState.status !== "completed") {
            phaseFailed = true;
            this.emitQueueInfo(
              planId,
              `Phase ${phaseNumber} stopped because task ${runState?.taskId ?? completedWorktree.taskId} ended with status ${runState?.status ?? "unknown"}.`,
              "error"
            );

            if (activeRunIds.size > 0) {
              await Promise.all(
                [...activeRunIds].map(async (runId) => {
                  await this.cancelRun({ runId }).catch(() => ({ ok: false }));
                  await this.waitForRun(runId);
                })
              );
              activeRunIds.clear();
            }

            await this.cleanupPhaseWorktrees(gitContext, [...unmergedWorktrees.values()], false);
            break;
          }

          try {
            await this.validatePhaseBranchCommits(planId, phaseNumber, [completedWorktree], gitContext);
            await this.mergePhaseBranches(
              planId,
              phaseNumber,
              [completedWorktree.branchName],
              gitContext
            );
            await this.cleanupPhaseWorktrees(gitContext, [completedWorktree], true);
            unmergedWorktrees.delete(completedWorktree.taskId);
            this.emitQueueInfo(
              planId,
              `Phase ${phaseNumber}: merged completed task ${runState.taskId} and removed its worktree.`
            );
          } catch (error) {
            if (activeRunIds.size > 0) {
              await Promise.all(
                [...activeRunIds].map(async (runId) => {
                  await this.cancelRun({ runId }).catch(() => ({ ok: false }));
                  await this.waitForRun(runId);
                })
              );
              activeRunIds.clear();
            }
            await this.cleanupPhaseWorktrees(gitContext, [...unmergedWorktrees.values()], false);
            throw error;
          }
        }

        if (this.abortedPlanQueues.has(planId)) {
          break;
        }

        if (phaseFailed) {
          break;
        }

        this.emitQueueInfo(
          planId,
          `Phase ${phaseNumber} merged successfully into ${gitContext.mergeTargetBranch}.`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown queue failure.";
      this.db.updatePlanStatus(planId, "failed");
      this.emitQueueInfo(planId, `Queue execution failed: ${message}`, "error");
    } finally {
      if (gitContext) {
        await this.tryRestoreBranch(gitContext, planId);
        await rm(gitContext.worktreeRoot, { recursive: true, force: true }).catch(() => undefined);
      }

      this.abortedPlanQueues.delete(planId);
    }
  }

  private async prepareQueueGitContext(plan: RalphPlan): Promise<QueueGitContext> {
    const repoRootResult = await this.runGitCommand(["rev-parse", "--show-toplevel"], plan.projectPath);
    const repoRoot = repoRootResult.stdout.trim();
    if (!repoRoot) {
      throw new Error("Unable to resolve repository root for queue execution.");
    }

    await this.autoCleanWorkspaceForQueue(plan.id, repoRoot);

    const statusResult = await this.runGitCommand(["status", "--porcelain"], repoRoot);
    if (statusResult.stdout.trim().length > 0) {
      throw new Error(
        "Repository still has uncommitted changes after automatic queue cleanup. Queue merges require a clean working tree in the main checkout."
      );
    }

    const branchResult = await this.runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
    const originalBranchRaw = branchResult.stdout.trim();
    const originalBranch = originalBranchRaw === "HEAD" ? null : originalBranchRaw;

    const hasMainBranch = (
      await this.safeRunGitCommand(["show-ref", "--verify", "--quiet", "refs/heads/main"], repoRoot)
    ).ok;
    const mergeTargetBranch = hasMainBranch ? "main" : originalBranch;

    if (!mergeTargetBranch) {
      throw new Error('Repository does not have a "main" branch and HEAD is detached.');
    }

    const repoToken = this.sanitizeToken(basename(repoRoot), 24);
    const planToken = this.sanitizeToken(plan.id, 20);
    const worktreeRoot = join(tmpdir(), "claude-ralph-worktrees", `${repoToken}-${planToken}`);

    await rm(worktreeRoot, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(worktreeRoot, { recursive: true });

    return {
      repoRoot,
      mergeTargetBranch,
      originalBranch,
      worktreeRoot
    };
  }

  private async autoCleanWorkspaceForQueue(planId: string, repoRoot: string): Promise<void> {
    const removedNul = await this.removeWindowsNulFileIfPresent(repoRoot);
    if (removedNul) {
      this.emitQueueInfo(planId, 'Removed root "nul" file before queue start.');
    }

    const statusBeforeCommit = await this.runGitCommand(["status", "--porcelain"], repoRoot);
    if (statusBeforeCommit.stdout.trim().length === 0) {
      return;
    }

    this.emitQueueInfo(
      planId,
      "Repository has local changes. Creating an automatic pre-queue commit."
    );

    await this.runGitCommand(["add", "-A"], repoRoot);

    const timestampToken = nowIso().replace(/[:.]/g, "-");
    const commitMessage = `chore(queue): auto-commit workspace before run-all (${timestampToken})`;
    await this.runGitCommand(["commit", "--no-verify", "-m", commitMessage], repoRoot);

    const commitHash = (await this.runGitCommand(["rev-parse", "--short", "HEAD"], repoRoot)).stdout.trim();
    this.emitQueueInfo(
      planId,
      `Created pre-queue auto-commit ${commitHash || "(hash unavailable)"}.`
    );

    const statusAfterCommit = await this.runGitCommand(["status", "--porcelain"], repoRoot);
    if (statusAfterCommit.stdout.trim().length > 0) {
      throw new Error(
        "Repository still has uncommitted changes after automatic pre-queue commit."
      );
    }
  }

  private async removeWindowsNulFileIfPresent(repoRoot: string): Promise<boolean> {
    const nulStatusBefore = await this.runGitCommand(["status", "--porcelain", "--", "nul"], repoRoot);
    if (nulStatusBefore.stdout.trim().length === 0) {
      return false;
    }

    if (process.platform === "win32") {
      const repoRootWindows = repoRoot.replace(/\//g, "\\");
      const namespacedNulPath = `\\\\?\\${repoRootWindows}\\nul`;
      await new Promise<void>((resolve, reject) => {
        execFile(
          "cmd",
          ["/d", "/s", "/c", `del /f /q "${namespacedNulPath}"`],
          {
            cwd: repoRoot,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024
          },
          (error, _stdout, stderr) => {
            if (error) {
              const details = String(stderr ?? "").trim() || error.message;
              reject(new Error(`Failed to remove root "nul" file: ${details}`));
              return;
            }
            resolve();
          }
        );
      });
    } else {
      await rm(join(repoRoot, "nul"), { force: true });
    }

    const nulStatusAfter = await this.runGitCommand(["status", "--porcelain", "--", "nul"], repoRoot);
    const hasUntrackedNul = nulStatusAfter.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => /^\?\?\s+"?nul"?$/i.test(line));

    if (hasUntrackedNul) {
      throw new Error('Failed to remove root "nul" file before queue start.');
    }

    return true;
  }

  private async createPhaseWorktrees(
    plan: RalphPlan,
    phaseNumber: number,
    phaseTasks: RalphTask[],
    gitContext: QueueGitContext
  ): Promise<PhaseWorktree[]> {
    const created: PhaseWorktree[] = [];
    const planToken = this.sanitizeToken(plan.id, 12);

    await this.safeRunGitCommand(["worktree", "prune"], gitContext.repoRoot);

    try {
      for (const [index, task] of phaseTasks.entries()) {
        const taskToken = this.sanitizeToken(task.id, 28);
        const branchName = `ralph/${planToken}/p${phaseNumber}-${index + 1}-${taskToken}`;
        const worktreePath = join(
          gitContext.worktreeRoot,
          `phase-${phaseNumber}-${index + 1}-${taskToken}`
        );

        await this.safeRunGitCommand(
          ["worktree", "remove", "--force", worktreePath],
          gitContext.repoRoot
        );
        await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
        await this.safeRunGitCommand(["worktree", "prune"], gitContext.repoRoot);

        const existingBranch = (
          await this.safeRunGitCommand(
            ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
            gitContext.repoRoot
          )
        ).ok;
        if (existingBranch) {
          await this.runGitCommand(["branch", "-D", branchName], gitContext.repoRoot);
        }

        await this.runGitCommand(
          ["worktree", "add", "-b", branchName, worktreePath, gitContext.mergeTargetBranch],
          gitContext.repoRoot
        );
        const baseCommit = (
          await this.runGitCommand(["rev-parse", "HEAD"], worktreePath)
        ).stdout.trim();

        created.push({
          taskId: task.id,
          branchName,
          path: worktreePath,
          baseCommit
        });
      }

      return created;
    } catch (error) {
      await this.cleanupPhaseWorktrees(gitContext, created, true);
      throw error;
    }
  }

  private async mergePhaseBranches(
    planId: string,
    phaseNumber: number,
    branches: string[],
    gitContext: QueueGitContext
  ): Promise<void> {
    let cleanResult = await this.runGitCommand(["status", "--porcelain"], gitContext.repoRoot);
    if (cleanResult.stdout.trim().length > 0) {
      this.emitQueueInfo(
        planId,
        `Main checkout became dirty before phase ${phaseNumber} merge. Running automatic cleanup/commit.`
      );
      await this.autoCleanWorkspaceForQueue(planId, gitContext.repoRoot);
      cleanResult = await this.runGitCommand(["status", "--porcelain"], gitContext.repoRoot);
      if (cleanResult.stdout.trim().length > 0) {
        throw new Error(
          `Cannot merge phase ${phaseNumber}: main checkout still contains uncommitted changes after automatic cleanup.`
        );
      }
    }

    const currentBranchResult = await this.runGitCommand(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      gitContext.repoRoot
    );
    const currentBranch = currentBranchResult.stdout.trim();
    if (currentBranch !== gitContext.mergeTargetBranch) {
      await this.runGitCommand(["checkout", gitContext.mergeTargetBranch], gitContext.repoRoot);
    }

    this.emitQueueInfo(
      planId,
      `Committer is merging phase ${phaseNumber} into ${gitContext.mergeTargetBranch} (${branches.length} branch(es)).`
    );
    void this.postDiscordNotification(
      {
        speaker: this.displayRoleLabel("committer"),
        title: `Queue Merge Started (Phase ${phaseNumber})`,
        description: "Merging completed phase worktrees into target branch.",
        level: "info",
        fields: [
          { name: "Plan", value: planId, inline: true },
          { name: "Target", value: gitContext.mergeTargetBranch, inline: true },
          { name: "Branches", value: branches.join("\n") || "(none)" }
        ]
      }
    );

    const beforeHead = (
      await this.runGitCommand(["rev-parse", gitContext.mergeTargetBranch], gitContext.repoRoot)
    ).stdout.trim();

    await this.agentService.mergePhaseWithCommitter({
      repoRoot: gitContext.repoRoot,
      targetBranch: gitContext.mergeTargetBranch,
      branches,
      phaseNumber,
      callbacks: {
        onLog: (line) => this.emitQueueInfo(planId, `[committer] ${line}`),
        onQuery: () => undefined
      }
    });

    const afterHead = (
      await this.runGitCommand(["rev-parse", gitContext.mergeTargetBranch], gitContext.repoRoot)
    ).stdout.trim();
    if (beforeHead === afterHead) {
      throw new Error(
        `Committer merge for phase ${phaseNumber} did not create any new commit on ${gitContext.mergeTargetBranch}.`
      );
    }

    for (const branch of branches) {
      const merged = await this.safeRunGitCommand(
        ["merge-base", "--is-ancestor", branch, gitContext.mergeTargetBranch],
        gitContext.repoRoot
      );
      if (!merged.ok) {
        throw new Error(
          `Committer merge validation failed: branch "${branch}" is not an ancestor of "${gitContext.mergeTargetBranch}".`
        );
      }
    }

    await this.validateCommitRangePolicy(
      gitContext.repoRoot,
      `${beforeHead}..${afterHead}`,
      `phase ${phaseNumber} merge`
    );
    void this.postDiscordNotification(
      {
        speaker: this.displayRoleLabel("committer"),
        title: `Queue Merge Completed (Phase ${phaseNumber})`,
        description: "All phase branches were merged and validated.",
        level: "info",
        fields: [
          { name: "Plan", value: planId, inline: true },
          { name: "Target", value: gitContext.mergeTargetBranch, inline: true },
          { name: "Before", value: beforeHead, inline: false },
          { name: "After", value: afterHead, inline: false }
        ]
      }
    );
  }

  private async validatePhaseBranchCommits(
    planId: string,
    phaseNumber: number,
    phaseWorktrees: PhaseWorktree[],
    gitContext: QueueGitContext
  ): Promise<void> {
    for (const phaseWorktree of phaseWorktrees) {
      const range = `${phaseWorktree.baseCommit}..${phaseWorktree.branchName}`;
      const countOutput = (
        await this.runGitCommand(["rev-list", "--count", range], gitContext.repoRoot)
      ).stdout.trim();
      const commitCount = Number.parseInt(countOutput, 10);

      if (!Number.isFinite(commitCount) || commitCount <= 0) {
        throw new Error(
          `Task ${phaseWorktree.taskId} on branch ${phaseWorktree.branchName} produced no commits. Committer must create a conventional commit.`
        );
      }

      await this.validateCommitRangePolicy(
        gitContext.repoRoot,
        range,
        `task ${phaseWorktree.taskId} (phase ${phaseNumber})`
      );
    }

    this.emitQueueInfo(
      planId,
      `Phase ${phaseNumber} commit policy validated (Conventional Commits + no Claude co-author trailers).`
    );
  }

  private async validateCommitRangePolicy(
    repoRoot: string,
    range: string,
    contextLabel: string
  ): Promise<void> {
    const logOutput = (
      await this.runGitCommand(
        ["log", "--format=%H%x1f%s%x1f%B%x1e", range],
        repoRoot
      )
    ).stdout;

    const records = logOutput
      .split("\x1e")
      .map((record) => record.trim())
      .filter((record) => record.length > 0);

    if (records.length === 0) {
      throw new Error(`No commits found in range ${range} for ${contextLabel}.`);
    }

    for (const record of records) {
      const [hash, subject = "", ...bodyParts] = record.split("\x1f");
      const body = bodyParts.join("\x1f");

      if (!CONVENTIONAL_COMMIT_HEADER.test(subject.trim())) {
        throw new Error(
          `Commit ${hash} in ${contextLabel} does not follow Conventional Commits: "${subject}".`
        );
      }

      if (CLAUDE_COAUTHOR_TRAILER.test(body)) {
        throw new Error(
          `Commit ${hash} in ${contextLabel} includes a forbidden Claude co-author trailer.`
        );
      }
    }
  }

  private async cleanupPhaseWorktrees(
    gitContext: QueueGitContext,
    phaseWorktrees: PhaseWorktree[],
    deleteBranches: boolean
  ): Promise<void> {
    await Promise.all(
      phaseWorktrees.map(async (phaseWorktree) => {
        await this.safeRunGitCommand(
          ["worktree", "remove", "--force", phaseWorktree.path],
          gitContext.repoRoot
        );
        await rm(phaseWorktree.path, { recursive: true, force: true }).catch(() => undefined);

        if (deleteBranches) {
          await this.safeRunGitCommand(
            ["branch", "-D", phaseWorktree.branchName],
            gitContext.repoRoot
          );
        }
      })
    );
  }

  private async tryRestoreBranch(gitContext: QueueGitContext, planId: string): Promise<void> {
    if (!gitContext.originalBranch || gitContext.originalBranch === gitContext.mergeTargetBranch) {
      return;
    }

    const restoreResult = await this.safeRunGitCommand(
      ["checkout", gitContext.originalBranch],
      gitContext.repoRoot
    );

    if (!restoreResult.ok) {
      this.emitQueueInfo(
        planId,
        `Queue finished, but switching back to "${gitContext.originalBranch}" failed: ${restoreResult.stderr}`,
        "error"
      );
    }
  }

  private sanitizeToken(input: string, maxLength = 32): string {
    const sanitized = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (sanitized.length === 0) {
      return "item";
    }

    return sanitized.slice(0, maxLength);
  }

  private async runGitCommand(
    args: string[],
    cwd: string
  ): Promise<{ stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        {
          cwd,
          windowsHide: true,
          maxBuffer: 32 * 1024 * 1024
        },
        (error, stdout, stderr) => {
          const normalizedStdout = String(stdout ?? "");
          const normalizedStderr = String(stderr ?? "");

          if (error) {
            const details = normalizedStderr.trim().length > 0 ? normalizedStderr.trim() : error.message;
            reject(new Error(`git ${args.join(" ")} failed in ${cwd}: ${details}`));
            return;
          }

          resolve({
            stdout: normalizedStdout,
            stderr: normalizedStderr
          });
        }
      );
    });
  }

  private async safeRunGitCommand(
    args: string[],
    cwd: string
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    try {
      const result = await this.runGitCommand(args, cwd);
      return {
        ok: true,
        stdout: result.stdout,
        stderr: result.stderr
      };
    } catch (error) {
      return {
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private parseArchitectureReviewPayload(payload: unknown): ArchitectureReviewSnapshot | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const record = payload as Record<string, unknown>;
    if (record.kind !== "architecture_review") {
      return null;
    }

    const review = record.review;
    if (!review || typeof review !== "object") {
      return null;
    }

    const reviewRecord = review as Record<string, unknown>;
    const status = typeof reviewRecord.status === "string" ? reviewRecord.status : "";
    const summary = typeof reviewRecord.summary === "string" ? reviewRecord.summary : "";
    const confidence =
      typeof reviewRecord.confidence === "number" && Number.isFinite(reviewRecord.confidence)
        ? reviewRecord.confidence
        : 0;

    const findings = Array.isArray(reviewRecord.findings)
      ? reviewRecord.findings
          .map((finding) => {
            if (!finding || typeof finding !== "object") {
              return null;
            }

            const findingRecord = finding as Record<string, unknown>;
            return {
              severity:
                typeof findingRecord.severity === "string" ? findingRecord.severity : "unknown",
              location:
                typeof findingRecord.location === "string" ? findingRecord.location : "unknown",
              rule: typeof findingRecord.rule === "string" ? findingRecord.rule : "other",
              message: typeof findingRecord.message === "string" ? findingRecord.message : "",
              recommendedAction:
                typeof findingRecord.recommendedAction === "string"
                  ? findingRecord.recommendedAction
                  : ""
            } as ArchitectureReviewFindingSnapshot;
          })
          .filter((finding): finding is ArchitectureReviewFindingSnapshot => {
            if (!finding) {
              return false;
            }
            return finding.message.trim().length > 0;
          })
      : [];

    return {
      status,
      summary,
      confidence,
      findings
    };
  }

  private createArchitectureFollowupProposals(input: {
    plan: RalphPlan;
    task: RalphTask;
    runId: string;
    review: ArchitectureReviewSnapshot;
  }): number {
    if (input.review.status !== "pass_with_notes" || input.review.findings.length === 0) {
      return 0;
    }

    let createdCount = 0;
    for (const finding of input.review.findings) {
      const findingKey = createHash("sha1")
        .update(
          [
            input.task.id,
            finding.severity,
            finding.rule,
            finding.location,
            finding.message,
            finding.recommendedAction
          ].join("|")
        )
        .digest("hex");

      const title = `Architecture follow-up: ${finding.rule} (${finding.location})`;
      const description = [
        finding.message.trim(),
        finding.recommendedAction.trim().length > 0
          ? `Recommended action: ${finding.recommendedAction.trim()}`
          : ""
      ]
        .filter((line) => line.length > 0)
        .join("\n");
      const acceptanceCriteria = [
        `Address architecture note at ${finding.location}.`,
        finding.recommendedAction.trim().length > 0
          ? `Apply this action: ${finding.recommendedAction.trim()}`
          : "Resolve the reported architecture note without widening scope.",
        "Keep behavior stable and run relevant tests."
      ];
      const technicalNotes = [
        `Source task: ${input.task.id}`,
        `Source run: ${input.runId}`,
        `Review status: ${input.review.status}`,
        `Review confidence: ${input.review.confidence}`,
        `Review summary: ${input.review.summary}`
      ].join("\n");

      const inserted = this.db.createTaskFollowupProposal({
        planId: input.plan.id,
        sourceRunId: input.runId,
        sourceTaskId: input.task.id,
        findingKey,
        title,
        description,
        severity: finding.severity,
        rule: finding.rule,
        location: finding.location,
        message: finding.message,
        recommendedAction: finding.recommendedAction,
        acceptanceCriteria,
        technicalNotes
      });
      if (inserted) {
        createdCount += 1;
      }
    }

    return createdCount;
  }

  private async executeRun(input: {
    runId: string;
    plan: RalphPlan;
    task: RalphTask;
    retryContext?: { retryCount: number; previousError: string };
    executionContext?: RunExecutionContext;
  }): Promise<void> {
    const startedAt = Date.now();
    let sessionId: string | null = null;
    const planProgressContext = this.buildPlanProgressContext(input.plan.id);
    let latestArchitectureReview: ArchitectureReviewSnapshot | null = null;

    try {
      const result = await this.agentService.runTask({
        plan: input.plan,
        task: input.task,
        planProgressContext,
        retryContext: input.retryContext,
        workingDirectory: input.executionContext?.workingDirectory,
        branchName: input.executionContext?.branchName,
        phaseNumber: input.executionContext?.phaseNumber,
        callbacks: {
          onLog: (line) => {
            this.emitEvent({
              runId: input.runId,
              planId: input.plan.id,
              taskId: input.task.id,
              type: "log",
              level: "info",
              payload: {
                line
              }
            });
          },
          onTodo: (todos: TodoItem[]) => {
            this.db.addTodoSnapshot(input.runId, todos);
            this.emitEvent({
              runId: input.runId,
              planId: input.plan.id,
              taskId: input.task.id,
              type: "todo_update",
              level: "info",
              payload: {
                todos
              }
            });
          },
          onSession: (newSessionId) => {
            sessionId = newSessionId;
            this.db.updateRun({
              runId: input.runId,
              status: "in_progress",
              sessionId: newSessionId
            });
          },
          onSubagent: (payload) => {
            const record =
              payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
            if (
              record &&
              (typeof record.subagent_type === "string" ||
                typeof record.prompt === "string" ||
                typeof record.description === "string")
            ) {
              void this.writeSubagentSpawnLog({
                runId: input.runId,
                planId: input.plan.id,
                taskId: input.task.id,
                payload: record
              });
            }
            const kind = typeof record?.kind === "string" ? record.kind : null;
            const parsedArchitectureReview = this.parseArchitectureReviewPayload(payload);
            if (parsedArchitectureReview) {
              latestArchitectureReview = parsedArchitectureReview;
            }
            const message =
              kind === "agent_stage"
                ? "Agent stage update received."
                : kind === "architecture_review"
                ? "Architecture review result received."
                : kind === "committer_summary"
                  ? "Committer summary received."
                  : "Subagent invocation detected.";

            this.notifyDiscordForSubagentPayload({
              plan: input.plan,
              task: input.task,
              payload
            });

            this.emitEvent({
              runId: input.runId,
              planId: input.plan.id,
              taskId: input.task.id,
              type: "info",
              level: "info",
              payload: {
                message,
                data: payload
              }
            });
          },
          onQuery: (queryHandle) => {
            const active = this.activeRuns.get(input.runId);
            if (active) {
              active.interrupt = queryHandle.interrupt;
            }
          }
        }
      });

      const active = this.activeRuns.get(input.runId);
      if (active?.cancelRequested) {
        this.db.updateRun({
          runId: input.runId,
          status: "cancelled",
          sessionId,
          endedAt: nowIso(),
          durationMs: Date.now() - startedAt,
          resultText: result.resultText,
          stopReason: result.stopReason,
          totalCostUsd: result.totalCostUsd
        });
        this.db.appendPlanProgressEntry({
          planId: input.plan.id,
          runId: input.runId,
          status: "cancelled",
          entryText: [
            `Task ${input.task.id} (${input.task.title}) was cancelled.`,
            result.stopReason ? `Stop reason: ${result.stopReason}` : "",
            result.resultText.trim()
          ]
            .filter((block) => block.length > 0)
            .join("\n\n")
        });

        this.db.updateTaskStatus(input.task.id, "pending");
        this.db.updatePlanStatus(input.plan.id, "ready");

        this.emitEvent({
          runId: input.runId,
          planId: input.plan.id,
          taskId: input.task.id,
          type: "cancelled",
          level: "info",
          payload: {
            message: "Run cancelled by user."
          }
        });
      } else {
        this.db.updateRun({
          runId: input.runId,
          status: "completed",
          sessionId: result.sessionId ?? sessionId,
          endedAt: nowIso(),
          durationMs: result.durationMs ?? Date.now() - startedAt,
          resultText: result.resultText,
          stopReason: result.stopReason,
          totalCostUsd: result.totalCostUsd
        });
        this.db.appendPlanProgressEntry({
          planId: input.plan.id,
          runId: input.runId,
          status: "completed",
          entryText: [
            `Task ${input.task.id} (${input.task.title}) completed successfully.`,
            result.stopReason ? `Stop reason: ${result.stopReason}` : "",
            result.resultText.trim()
          ]
            .filter((block) => block.length > 0)
            .join("\n\n")
        });
        const createdFollowups = latestArchitectureReview
          ? this.createArchitectureFollowupProposals({
              plan: input.plan,
              task: input.task,
              runId: input.runId,
              review: latestArchitectureReview
            })
          : 0;
        if (createdFollowups > 0) {
          this.emitEvent({
            runId: input.runId,
            planId: input.plan.id,
            taskId: input.task.id,
            type: "info",
            level: "info",
            payload: {
              kind: "architecture_followup_proposals",
              count: createdFollowups,
              message:
                `Architecture review produced ${createdFollowups} follow-up proposal(s). ` +
                "Approve proposals from the plan detail view to add them to the checklist."
            }
          });
        }

        this.db.updateTaskStatus(input.task.id, "completed");
        const allTasksCompleted = this.db
          .getTasks(input.plan.id)
          .every((task) => task.status === "completed" || task.status === "skipped");
        const queueExecution = input.executionContext?.phaseNumber !== undefined;
        const nextPlanStatus = allTasksCompleted
          ? "completed"
          : queueExecution
            ? "running"
            : "ready";
        this.db.updatePlanStatus(input.plan.id, nextPlanStatus);

        this.emitEvent({
          runId: input.runId,
          planId: input.plan.id,
          taskId: input.task.id,
          type: "task_status",
          level: "info",
          payload: {
            status: "completed"
          }
        });

        this.emitEvent({
          runId: input.runId,
          planId: input.plan.id,
          taskId: input.task.id,
          type: "completed",
          level: "info",
          payload: {
            stopReason: result.stopReason,
            totalCostUsd: result.totalCostUsd,
            durationMs: result.durationMs
          }
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown run failure.";

      this.db.updateRun({
        runId: input.runId,
        status: "failed",
        sessionId,
        endedAt: nowIso(),
        durationMs: Date.now() - startedAt,
        errorText: message
      });
      this.db.appendPlanProgressEntry({
        planId: input.plan.id,
        runId: input.runId,
        status: "failed",
        entryText: [
          `Task ${input.task.id} (${input.task.title}) failed.`,
          `Error: ${message}`
        ].join("\n\n")
      });

      this.db.updateTaskStatus(input.task.id, "failed");
      this.db.updatePlanStatus(input.plan.id, "failed");

      this.emitEvent({
        runId: input.runId,
        planId: input.plan.id,
        taskId: input.task.id,
        type: "task_status",
        level: "error",
        payload: {
          status: "failed"
        }
      });

      this.emitEvent({
        runId: input.runId,
        planId: input.plan.id,
        taskId: input.task.id,
        type: "failed",
        level: "error",
        payload: {
          error: message
        }
      });
    } finally {
      this.activeRuns.delete(input.runId);
      const completion = this.runCompletion.get(input.runId);
      completion?.resolve();
      this.runCompletion.delete(input.runId);
    }
  }

  private getDiscordWebhookUrl(): string | null {
    const url = this.db.getAppSettings().discordWebhookUrl.trim();
    return url.length > 0 ? url : null;
  }

  private truncateForDiscord(text: string, maxLength = 1800): string {
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength - 3)}...`;
  }

  private toDiscordColor(level: "info" | "error"): number {
    return level === "error" ? 0xdc2626 : 0x2563eb;
  }

  private speakerToAvatarUrl(speaker: string): string {
    const seed = encodeURIComponent(speaker.trim().toLowerCase() || "ralph");
    return `https://api.dicebear.com/9.x/bottts-neutral/png?seed=${seed}`;
  }

  private displayRoleLabel(rawRole: string): string {
    switch (rawRole) {
      case "task_execution":
        return "Task Execution Agent";
      case "architecture_specialist":
        return "Architecture Specialist";
      case "tester":
        return "Tester Agent";
      case "committer":
        return "Committer Agent";
      case "plan_synthesis":
        return "Plan Synthesis Agent";
      case "discovery_specialist":
        return "Discovery Specialist";
      default:
        return rawRole
          .split(/[_-]/g)
          .filter((part) => part.length > 0)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
    }
  }

  private buildDiscordPayload(input: DiscordNotificationInput): Record<string, unknown> {
    const fields = (input.fields ?? [])
      .slice(0, 8)
      .map((field) => ({
        name: this.truncateForDiscord(field.name, 256),
        value: this.truncateForDiscord(field.value, 1024),
        inline: field.inline ?? false
      }))
      .filter((field) => field.name.trim().length > 0 && field.value.trim().length > 0);

    const embed: Record<string, unknown> = {
      title: this.truncateForDiscord(input.title, 256),
      description: this.truncateForDiscord(input.description ?? "", 4096),
      color: this.toDiscordColor(input.level ?? "info"),
      timestamp: new Date().toISOString(),
      author: {
        name: input.speaker
      },
      footer: {
        text: input.footer ?? "Ralph Desktop"
      }
    };

    if (fields.length > 0) {
      embed.fields = fields;
    }

    return {
      username: input.speaker,
      avatar_url: this.speakerToAvatarUrl(input.speaker),
      embeds: [embed],
      allowed_mentions: {
        parse: []
      }
    };
  }

  private compactDiscordFields(
    fields: Array<DiscordNotificationField | null | undefined>
  ): DiscordNotificationField[] {
    return fields.filter((field): field is DiscordNotificationField => field !== null && field !== undefined);
  }

  private async postDiscordNotification(input: DiscordNotificationInput): Promise<void> {
    const webhookUrl = this.getDiscordWebhookUrl();
    if (!webhookUrl) {
      return;
    }
    if (typeof fetch !== "function") {
      console.warn("[TaskRunner] Global fetch is unavailable; Discord notifications are disabled.");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(this.buildDiscordPayload(input)),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Discord webhook returned ${response.status}: ${body.slice(0, 180)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[TaskRunner] Failed to send Discord webhook notification: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private notifyDiscordForDiscoveryEvent(event: Omit<DiscoveryEvent, "id" | "ts">): void {
    const isSynthesisStatus =
      event.type === "status" && /synth|synthesis/i.test(event.message);
    if (event.type !== "agent" && event.type !== "completed" && event.type !== "failed" && !isSynthesisStatus) {
      return;
    }

    const speaker = event.agent
      ? this.displayRoleLabel(event.agent)
      : "Discovery Orchestrator";

    void this.postDiscordNotification({
      speaker,
      title: `Discovery ${event.type.replace(/_/g, " ")}`,
      description: [event.message, event.details].filter(Boolean).join("\n"),
      level: event.level,
      fields: this.compactDiscordFields([
        { name: "Session", value: event.sessionId, inline: true },
        event.agent ? { name: "Agent", value: event.agent, inline: true } : null
      ])
    });
  }

  private notifyDiscordForSubagentPayload(input: {
    plan: RalphPlan;
    task: RalphTask;
    payload: unknown;
  }): void {
    const record =
      input.payload && typeof input.payload === "object"
        ? (input.payload as Record<string, unknown>)
        : null;
    if (!record) {
      return;
    }

    const kind = typeof record.kind === "string" ? record.kind : null;
    if (!kind) {
      return;
    }

    if (kind === "agent_stage") {
      const role = typeof record.agentRole === "string" ? record.agentRole : "unknown";
      const stage = typeof record.stage === "string" ? record.stage : "unknown";
      const status = typeof record.status === "string" ? record.status : "unknown";
      const summary = typeof record.summary === "string" ? record.summary : "";
      const stopReason = typeof record.stopReason === "string" ? record.stopReason : "";
      const level: "info" | "error" = status === "failed" ? "error" : "info";
      void this.postDiscordNotification({
        speaker: this.displayRoleLabel(role),
        title: `${stage} • ${status}`,
        description: this.truncateForDiscord(summary || "Stage update received.", 1200),
        level,
        fields: this.compactDiscordFields([
          { name: "Plan", value: input.plan.id, inline: true },
          { name: "Task", value: input.task.id, inline: true },
          { name: "Role", value: role, inline: true },
          stopReason
            ? { name: "Stop Reason", value: this.truncateForDiscord(stopReason, 600) }
            : null
        ])
      });
      return;
    }

    if (kind === "architecture_review") {
      const review =
        record.review && typeof record.review === "object"
          ? (record.review as Record<string, unknown>)
          : null;
      const findings = Array.isArray(review?.findings) ? review.findings : [];
      const topFindings = findings
        .slice(0, 3)
        .map((finding) => {
          if (!finding || typeof finding !== "object") return null;
          const item = finding as Record<string, unknown>;
          return `${String(item.severity ?? "unknown")} ${String(item.rule ?? "other")} @ ${String(item.location ?? "unknown")}: ${String(item.message ?? "")}`;
        })
        .filter((line): line is string => !!line);

      const reviewStatus = String(review?.status ?? "unknown");
      const level: "info" | "error" =
        reviewStatus === "blocked" || reviewStatus === "needs_refactor" ? "error" : "info";
      void this.postDiscordNotification({
        speaker: this.displayRoleLabel("architecture_specialist"),
        title: `Architecture Review • ${reviewStatus}`,
        description: this.truncateForDiscord(String(review?.summary ?? ""), 1200),
        level,
        fields: this.compactDiscordFields([
          { name: "Plan", value: input.plan.id, inline: true },
          { name: "Task", value: input.task.id, inline: true },
          {
            name: "Iteration",
            value: `${String(record.iteration ?? "?")}/${String(record.maxIterations ?? "?")}`,
            inline: true
          },
          {
            name: "Confidence",
            value: String(review?.confidence ?? "n/a"),
            inline: true
          },
          topFindings.length > 0
            ? {
              name: "Top Findings",
              value: this.truncateForDiscord(topFindings.join("\n"), 1000)
            }
            : null
        ])
      });
      return;
    }

    if (kind === "committer_summary") {
      void this.postDiscordNotification({
        speaker: this.displayRoleLabel("committer"),
        title: "Committer Summary",
        description: "Commit range created successfully for this task.",
        level: "info",
        fields: [
          { name: "Plan", value: input.plan.id, inline: true },
          { name: "Task", value: input.task.id, inline: true },
          { name: "Head Before", value: String(record.headBefore ?? "unknown") },
          { name: "Head After", value: String(record.headAfter ?? "unknown") }
        ]
      });
    }
  }

  private emitEvent(event: Omit<RunEvent, "id" | "ts">): void {
    const payload: RunEvent = {
      id: randomUUID(),
      ts: nowIso(),
      ...event
    };

    // Queue-level informational events have no backing run row and should
    // only be emitted to the renderer, not persisted in run_events.
    if (payload.runId.trim().length > 0) {
      this.db.appendRunEvent(payload);
    }

    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send(IPC_CHANNELS.runEvent, payload);
  }

  private emitDiscoveryEvent(event: Omit<DiscoveryEvent, "id" | "ts">): void {
    const payload: DiscoveryEvent = {
      id: randomUUID(),
      ts: nowIso(),
      ...event
    };

    this.notifyDiscordForDiscoveryEvent(event);

    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send(IPC_CHANNELS.discoveryEvent, payload);
  }

  private async waitForRun(runId: string): Promise<void> {
    const completion = this.runCompletion.get(runId);
    if (!completion) {
      return;
    }

    await completion.promise;
  }
}
