import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "@shared/ipc";
import type {
  AgentRole,
  CancelRunInput,
  CancelRunResponse,
  ContinueDiscoveryInput,
  CreatePlanInput,
  CreatePlanResponse,
  DiscoveryAnswer,
  DiscoveryEvent,
  DiscoveryInterviewState,
  DiscoverySessionSummary,
  GetWizardGuidanceInput,
  InferStackInput,
  ListPlansFilter,
  ModelConfigEntry,
  PlanListItem,
  RalphPlan,
  RalphTask,
  RunAllInput,
  RunAllResponse,
  RunEvent,
  RunTaskInput,
  RunTaskResponse,
  StartDiscoveryInput,
  TodoItem
} from "@shared/types";
import { AppDatabase } from "./app-database";
import { RalphAgentService, type ModelConfigMap } from "./ralph-agent-service";

interface ActiveRun {
  interrupt?: () => Promise<void>;
  cancelRequested: boolean;
}

interface DiscoverySession {
  id: string;
  projectPath: string;
  seedSentence: string;
  additionalContext: string;
  answerHistory: DiscoveryAnswer[];
  round: number;
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

export class TaskRunner {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly runCompletion = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  private readonly runningPlanQueues = new Set<string>();
  private readonly discoverySessions = new Map<string, DiscoverySession>();
  private readonly agentService: RalphAgentService;

  constructor(
    private readonly db: AppDatabase,
    private readonly getWindow: () => BrowserWindow | null
  ) {
    this.agentService = new RalphAgentService(this.buildModelConfigMap());
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

  /**
   * Rebuild the agent service with fresh model configuration from the database.
   * Called after model config changes so subsequent SDK calls use updated models.
   */
  refreshModelConfig(): void {
    const newService = new RalphAgentService(this.buildModelConfigMap());
    // Replace agentService reference -- requires dropping readonly for this controlled mutation
    (this as { agentService: RalphAgentService }).agentService = newService;
  }

  getPlan(planId: string): RalphPlan | null {
    return this.db.getPlan(planId);
  }

  listPlans(filter?: ListPlansFilter): PlanListItem[] {
    return this.db.listPlans(filter);
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

  getModelConfig(): ModelConfigEntry[] {
    return this.db.getModelConfig();
  }

  updateModelForRole(role: AgentRole, modelId: string): void {
    this.db.updateModelForRole(role, modelId);
    this.refreshModelConfig();
  }

  async startDiscovery(input: StartDiscoveryInput): Promise<DiscoveryInterviewState> {
    const sessionId = randomUUID();
    const session: DiscoverySession = {
      id: sessionId,
      projectPath: input.projectPath,
      seedSentence: input.seedSentence,
      additionalContext: input.additionalContext,
      answerHistory: [],
      round: 0
    };

    this.discoverySessions.set(sessionId, session);
    this.emitDiscoveryEvent({
      sessionId,
      type: "status",
      level: "info",
      message: "Discovery started. Spawning specialist agents..."
    });

    try {
      const initialState = await this.agentService.startDiscovery({
        projectPath: input.projectPath,
        seedSentence: input.seedSentence,
        additionalContext: input.additionalContext,
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

      session.round = 1;

      const fullState: DiscoveryInterviewState = {
        sessionId,
        round: session.round,
        ...initialState
      };

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
      this.emitDiscoveryEvent({
        sessionId,
        type: "failed",
        level: "error",
        message
      });
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
      const nextState = await this.agentService.continueDiscovery({
        projectPath: session.projectPath,
        seedSentence: session.seedSentence,
        additionalContext: session.additionalContext,
        answerHistory: session.answerHistory,
        latestAnswers: input.answers,
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

      session.round += 1;

      const fullState: DiscoveryInterviewState = {
        sessionId: session.id,
        round: session.round,
        ...nextState
      };

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
      this.emitDiscoveryEvent({
        sessionId: session.id,
        type: "failed",
        level: "error",
        message
      });
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
      round: dbSession.roundNumber
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

  async getWizardGuidance(input: GetWizardGuidanceInput) {
    return await this.agentService.getWizardGuidance(input);
  }

  async inferStack(input: InferStackInput) {
    return await this.agentService.inferStack(input);
  }

  async createPlan(input: CreatePlanInput): Promise<CreatePlanResponse> {
    const planResult = await this.agentService.createPlan({
      projectPath: input.projectPath,
      prdText: input.prdText
    });

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

      normalizedIds.add(candidate);
      taskIdMap.set(item.id, candidate);

      return {
        id: candidate,
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
        .map((dependencyId) => taskIdMap.get(dependencyId) ?? normalizeTaskId(dependencyId, task.ordinal))
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

    return { planId };
  }

  async runTask(input: RunTaskInput): Promise<RunTaskResponse> {
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
      status: "in_progress"
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
        message: "Task execution started.",
        taskTitle: task.title
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
      task
    });

    return { runId };
  }

  async runAll(input: RunAllInput): Promise<RunAllResponse> {
    if (this.runningPlanQueues.has(input.planId)) {
      return {
        queued: 0
      };
    }

    const estimated = this.db.countRunnableTasks(input.planId);

    this.runningPlanQueues.add(input.planId);
    void this.executeQueue(input.planId).finally(() => {
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
    if (active.interrupt) {
      await active.interrupt();
    }

    return { ok: true };
  }

  private async executeQueue(planId: string): Promise<void> {
    while (true) {
      const task = this.db.findNextRunnableTask(planId);
      if (!task) {
        break;
      }

      const run = await this.runTask({ planId, taskId: task.id });
      await this.waitForRun(run.runId);

      const runState = this.db.getRun(run.runId);
      if (!runState || runState.status !== "completed") {
        break;
      }
    }
  }

  private async executeRun(input: { runId: string; plan: RalphPlan; task: RalphTask }): Promise<void> {
    const startedAt = Date.now();
    let sessionId: string | null = null;

    try {
      const result = await this.agentService.runTask({
        plan: input.plan,
        task: input.task,
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
            this.emitEvent({
              runId: input.runId,
              planId: input.plan.id,
              taskId: input.task.id,
              type: "info",
              level: "info",
              payload: {
                message: "Subagent invocation detected.",
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

        this.db.updateTaskStatus(input.task.id, "completed");
        const allTasksCompleted = this.db
          .getTasks(input.plan.id)
          .every((task) => task.status === "completed");
        this.db.updatePlanStatus(input.plan.id, allTasksCompleted ? "completed" : "running");

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

  private emitEvent(event: Omit<RunEvent, "id" | "ts">): void {
    const payload: RunEvent = {
      id: randomUUID(),
      ts: nowIso(),
      ...event
    };

    this.db.appendRunEvent(payload);

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
