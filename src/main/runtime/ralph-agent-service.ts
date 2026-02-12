import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AgentRole,
  DiscoveryAnswer,
  DiscoveryInferredContext,
  DiscoveryInterviewState,
  GetWizardGuidanceInput,
  InferStackInput,
  InferStackResult,
  RalphPlan,
  RalphTask,
  TodoItem,
  WizardGuidanceResult
} from "@shared/types";
import {
  technicalPackJsonSchema,
  technicalPackSchema,
  type TechnicalPackOutput
} from "./ralph-schema";
import {
  baseOptions,
  DEFAULT_MODEL_BY_ROLE,
  DISCOVERY_CONTEXT_CHANGE_HINT_PATTERN,
  FALLBACK_DYNAMIC_DISCOVERY_JOBS,
  FULL_DISCOVERY_REFRESH_TOKEN_PATTERN,
  GIT_MERGE_COMMAND_PATTERN,
  MAX_ARCH_REFACTOR_CYCLES,
  MAX_DYNAMIC_DISCOVERY_AGENTS,
  MIN_DYNAMIC_DISCOVERY_AGENTS,
  MUTATING_GIT_COMMAND_PATTERN,
  STACK_CHANGE_HINT_PATTERN,
  STACK_PROFILE_DIR,
  STACK_PROFILE_FILE,
  STACK_REFRESH_TOKEN_PATTERN,
  STACK_SPECIALIST_ID,
  STACK_SPECIALIST_JOB,
  type SpecialistJob
} from "./agent-constants";
import {
  architectureReviewJsonSchema,
  architectureReviewSchema,
  type ArchitectureReview,
  discoveryAgentPlanJsonSchema,
  discoveryAgentPlanSchema,
  discoveryOutputJsonSchema,
  discoveryOutputSchema,
  inferStackJsonSchema,
  inferStackSchema,
  specialistAnalysisJsonSchema,
  specialistAnalysisSchema,
  stackProfileCacheSchema,
  wizardGuidanceJsonSchema,
  wizardGuidanceSchema
} from "./agent-schemas";
import {
  allocateUniqueDiscoveryAgentId,
  enforceArchitectureQualityGate,
  extractAssistantToolBlocks,
  extractBashCommand,
  extractTextDelta,
  formatAnswers,
  mapStageToAgentRole,
  normalizeConfidencePercent,
  parseTaskToolInvocation,
  readGitHeadCommit,
  resolveQueryCwd,
  runGitCommand,
  summarizeArchitectureFindings,
  tryParseStructuredOutputFromText,
  validateCommitPolicyForRange
} from "./agent-utils";

/** Map of agent role to model ID, loaded from model_config DB table. */
export type ModelConfigMap = Map<AgentRole, string>;

interface CreatePlanArgs {
  projectPath: string;
  prdText: string;
  projectHistoryContext?: string;
  onLog?: (line: string) => void;
}

interface CreatePlanResult {
  summary: string;
  technicalPack: TechnicalPackOutput;
}

interface RunTaskCallbacks {
  onLog: (line: string) => void;
  onTodo: (todos: TodoItem[]) => void;
  onSession: (sessionId: string) => void;
  onSubagent: (payload: unknown) => void;
  onQuery: (queryHandle: { interrupt: () => Promise<void> }) => void;
}

interface RetryContext {
  retryCount: number;
  previousError: string;
}

interface RunTaskArgs {
  plan: RalphPlan;
  task: RalphTask;
  planProgressContext?: string;
  callbacks: RunTaskCallbacks;
  retryContext?: RetryContext;
  workingDirectory?: string;
  branchName?: string;
  phaseNumber?: number;
}

interface RunTaskResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
}

interface CommitterCallbacks {
  onLog: (line: string) => void;
  onQuery: (queryHandle: { interrupt: () => Promise<void> }) => void;
}

interface MergePhaseArgs {
  repoRoot: string;
  targetBranch: string;
  branches: string[];
  phaseNumber: number;
  mergeContextSummary?: string;
  validationCommands?: string[];
  callbacks: CommitterCallbacks;
}

interface MergePhaseResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
}

interface StabilizePhaseIntegrationArgs {
  repoRoot: string;
  targetBranch: string;
  integrationBranch: string;
  phaseNumber: number;
  phaseContextSummary?: string;
  validationCommands: string[];
  callbacks: CommitterCallbacks;
}

interface StabilizePhaseIntegrationResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
}

interface DiscoveryOutput {
  directionSummary: string;
  inferredContext: DiscoveryInferredContext;
  questions: Array<{
    id: string;
    question: string;
    reason: string;
    question_type: "multiple_choice";
    options: string[];
    recommendedOption: string;
    selectionMode: "single" | "multi";
  }>;
  prdInputDraft: string;
  readinessScore: number;
  missingCriticalInfo: string[];
}

interface DiscoveryStreamEvent {
  type: "status" | "log" | "agent";
  level: "info" | "error";
  message: string;
  agent?: string;
  details?: string;
}

interface DiscoveryCallbacks {
  onEvent: (event: DiscoveryStreamEvent) => void;
}

interface StartDiscoveryArgs {
  projectPath: string;
  seedSentence: string;
  additionalContext: string;
  callbacks?: DiscoveryCallbacks;
}

interface ContinueDiscoveryArgs extends StartDiscoveryArgs {
  answerHistory: DiscoveryAnswer[];
  latestAnswers: DiscoveryAnswer[];
  previousState?: DiscoveryInterviewState | null;
  stackRefreshContext?: string;
}

interface SpecialistAnalysis {
  summary: string;
  findings: string[];
  signals: string[];
  painPoints: string[];
  constraints: string[];
  scopeHints: string[];
  stackHints: string[];
  documentationHints: string[];
  questions: string[];
  confidence: number;
}

export interface StackProfileCache {
  version: 1;
  updatedAt: string;
  specialistId: typeof STACK_SPECIALIST_ID;
  stackSummary: string;
  stackHints: string[];
  signals: string[];
  confidence: number;
}

export interface StackProfileStore {
  read(projectPath: string): Promise<StackProfileCache | null> | StackProfileCache | null;
  write(projectPath: string, profile: StackProfileCache): Promise<void> | void;
}

export class RalphAgentService {
  private readonly modelConfig: ModelConfigMap;
  private readonly stackProfileStore?: StackProfileStore;

  constructor(modelConfig?: ModelConfigMap, stackProfileStore?: StackProfileStore) {
    this.modelConfig = modelConfig ?? new Map();
    this.stackProfileStore = stackProfileStore;
  }

  /**
   * Resolve the model ID for a given agent role.
   * Falls back to opinionated defaults when no DB config exists.
   */
  private getModel(role: AgentRole): string {
    return this.modelConfig.get(role) ?? DEFAULT_MODEL_BY_ROLE[role];
  }

  private resolveStackProfilePath(projectPath: string): string | null {
    const normalized = projectPath.trim();
    if (normalized.length === 0 || !existsSync(normalized)) {
      return null;
    }
    return join(normalized, STACK_PROFILE_DIR, STACK_PROFILE_FILE);
  }

  private async readStackProfileCache(projectPath: string): Promise<StackProfileCache | null> {
    if (this.stackProfileStore) {
      try {
        const fromStore = await this.stackProfileStore.read(projectPath);
        if (!fromStore) {
          return null;
        }
        return stackProfileCacheSchema.parse(fromStore);
      } catch {
        return null;
      }
    }

    const profilePath = this.resolveStackProfilePath(projectPath);
    if (!profilePath) {
      return null;
    }

    try {
      const raw = await readFile(profilePath, "utf8");
      const parsed = JSON.parse(raw);
      return stackProfileCacheSchema.parse(parsed);
    } catch {
      return null;
    }
  }

  private async writeStackProfileCache(projectPath: string, report: SpecialistAnalysis): Promise<void> {
    const payload = this.buildStackProfilePayload(report);

    if (this.stackProfileStore) {
      try {
        await this.stackProfileStore.write(projectPath, payload);
      } catch {
        // Cache write failure should never block discovery.
      }
      return;
    }

    const profilePath = this.resolveStackProfilePath(projectPath);
    if (!profilePath) {
      return;
    }

    try {
      await mkdir(dirname(profilePath), { recursive: true });
      await writeFile(profilePath, JSON.stringify(payload, null, 2), "utf8");
    } catch {
      // Cache write failure should never block discovery.
    }
  }

  private buildStackProfilePayload(report: SpecialistAnalysis): StackProfileCache {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      specialistId: STACK_SPECIALIST_ID,
      stackSummary: report.summary,
      stackHints: report.stackHints,
      signals: report.signals,
      confidence: report.confidence
    };
  }

  private shouldRefreshStackAnalysis(additionalContext: string, latestAnswers: DiscoveryAnswer[]): boolean {
    const combined = [additionalContext, ...latestAnswers.map((entry) => entry.answer)]
      .filter((value) => value.trim().length > 0)
      .join("\n");

    if (combined.length === 0) {
      return false;
    }

    if (STACK_REFRESH_TOKEN_PATTERN.test(combined)) {
      return true;
    }

    return STACK_CHANGE_HINT_PATTERN.test(combined);
  }

  private shouldForceFullDiscoveryRefresh(additionalContext: string, latestAnswers: DiscoveryAnswer[]): boolean {
    const combined = [additionalContext, ...latestAnswers.map((entry) => entry.answer)]
      .filter((value) => value.trim().length > 0)
      .join("\n");

    if (combined.length === 0) {
      return false;
    }

    if (FULL_DISCOVERY_REFRESH_TOKEN_PATTERN.test(combined)) {
      return true;
    }

    return DISCOVERY_CONTEXT_CHANGE_HINT_PATTERN.test(combined);
  }

  async refreshStackProfile(args: {
    projectPath: string;
    additionalContext?: string;
    callbacks?: DiscoveryCallbacks;
  }): Promise<StackProfileCache> {
    const normalizedPath = args.projectPath.trim();
    if (normalizedPath.length === 0) {
      throw new Error("Cannot refresh stack profile without a project path.");
    }

    const cwd = resolveQueryCwd(normalizedPath);

    const prompt = `
Stack profile refresh request.

Project path:
${normalizedPath}

Additional context:
${args.additionalContext || "none"}

Goal:
- Analyze the current codebase stack as it exists now.
- Detect stack signals from repository artifacts.
- Produce a precise summary for future planning continuity.
`;

    const result = await this.runSpecialistAnalysis({
      job: STACK_SPECIALIST_JOB,
      prompt,
      cwd,
      maxTurns: 8,
      callbacks: args.callbacks
    });

    await this.writeStackProfileCache(normalizedPath, result.report);
    return this.buildStackProfilePayload(result.report);
  }

  async startDiscovery(args: StartDiscoveryArgs): Promise<DiscoveryOutput> {
    const hasProjectPath = args.projectPath.trim().length > 0 && existsSync(args.projectPath.trim());
    const cwd = resolveQueryCwd(args.projectPath);
    const stackCache = await this.readStackProfileCache(args.projectPath);
    const includeStackSpecialist = stackCache === null;

    const prompt = `
Discovery context for PRD interview:

User seed sentence:
${args.seedSentence}

Additional user context:
${args.additionalContext || "none"}

Project path:
${args.projectPath || "(not provided)"}
Project mode:
${hasProjectPath ? "existing codebase" : "new/unspecified project"}

Phase:
- Initial discovery

Goal:
- Turn this short request into a precise execution-ready PRD input.
- Ask many high-impact clarification questions and remove ambiguity.
`;

    return await this.runDiscoveryPrompt(prompt, cwd, 24, args.callbacks, {
      projectPath: args.projectPath,
      includeStackSpecialist,
      stackCache,
      stackRefreshReason: includeStackSpecialist
        ? "No stack cache found; running stack analysis."
        : null
    });
  }

  async continueDiscovery(args: ContinueDiscoveryArgs): Promise<DiscoveryOutput> {
    const cwd = resolveQueryCwd(args.projectPath);
    const stackCache = await this.readStackProfileCache(args.projectPath);
    const refreshContext = args.stackRefreshContext ?? args.additionalContext;
    const refreshStack = this.shouldRefreshStackAnalysis(refreshContext, args.latestAnswers);
    const forceFullRefresh = this.shouldForceFullDiscoveryRefresh(refreshContext, args.latestAnswers);
    const canReusePriorContext = Boolean(args.previousState) && !refreshStack && !forceFullRefresh;
    const includeStackSpecialist = stackCache === null || refreshStack;
    const stackRefreshReason = canReusePriorContext
      ? null
      : refreshStack
        ? "Detected stack-change signal in latest answers/context. Re-running stack specialist."
        : forceFullRefresh
          ? "Detected significant context change in latest answers/context. Re-running full discovery analyses."
        : stackCache === null
          ? "No stack cache found; running stack analysis."
          : null;

    const prompt = `
Discovery continuation context for PRD interview:

Original seed sentence:
${args.seedSentence}

Additional user context:
${args.additionalContext || "none"}

Project path:
${args.projectPath || "(not provided)"}

All answers so far:
${formatAnswers(args.answerHistory)}

Latest answers:
${formatAnswers(args.latestAnswers)}

Phase:
- Continue discovery with follow-up answers

Goal:
- Refine PRD direction with the new answers.
- Ask only unresolved high-impact follow-up questions.
- Produce an increasingly decision-complete PRD input draft.
`;

    return await this.runDiscoveryPrompt(prompt, cwd, 20, args.callbacks, {
      projectPath: args.projectPath,
      includeStackSpecialist,
      stackCache,
      stackRefreshReason,
      skipAnalysisRefresh: canReusePriorContext,
      carryForwardState: args.previousState ?? null
    });
  }

  private buildFallbackDiscoveryJobs(includeStackSpecialist: boolean): SpecialistJob[] {
    const usedIds = new Set<string>();
    const jobs: SpecialistJob[] = [];

    if (includeStackSpecialist) {
      jobs.push({
        ...STACK_SPECIALIST_JOB,
        id: allocateUniqueDiscoveryAgentId(STACK_SPECIALIST_JOB.id, 1, usedIds),
        producesStackProfile: true
      });
    }

    for (const fallbackJob of FALLBACK_DYNAMIC_DISCOVERY_JOBS) {
      if (jobs.length >= MAX_DYNAMIC_DISCOVERY_AGENTS) {
        break;
      }
      jobs.push({
        ...fallbackJob,
        id: allocateUniqueDiscoveryAgentId(fallbackJob.id, jobs.length + 1, usedIds),
        producesStackProfile: false
      });
    }

    if (jobs.length === 0) {
      jobs.push({
        id: allocateUniqueDiscoveryAgentId("analysis-agent", 1, usedIds),
        title: "General discovery analysis",
        objective:
          "Identify unresolved product, scope, and delivery decisions needed to produce a complete pre-PRD draft.",
        producesStackProfile: false
      });
    }

    return jobs;
  }

  private async planDynamicDiscoveryJobs(input: {
    prompt: string;
    cwd: string;
    maxTurns: number;
    callbacks?: DiscoveryCallbacks;
    includeStackSpecialist: boolean;
    stackCache?: StackProfileCache | null;
    projectPath?: string;
  }): Promise<{ jobs: SpecialistJob[]; rationale: string }> {
    const projectPath = input.projectPath?.trim() ?? "";
    const hasProjectPath = projectPath.length > 0 && existsSync(projectPath);
    const stackCacheSummary =
      input.stackCache
        ? JSON.stringify(
            {
              stackSummary: input.stackCache.stackSummary,
              stackHints: input.stackCache.stackHints,
              signals: input.stackCache.signals,
              confidence: input.stackCache.confidence,
              updatedAt: input.stackCache.updatedAt
            },
            null,
            2
          )
        : "none";

    const plannerPrompt = `
You are the master discovery orchestrator for Ralph mode.

Objective:
- Decide which analysis agents are required for this round to reach a complete pre-PRD.
- This step plans agents only. Do not run analyses yourself.

Discovery context:
${input.prompt}

Project path:
${projectPath || "(not provided)"}
Project mode:
${hasProjectPath ? "existing codebase" : "new/unspecified project"}

Cached project memory / stack profile (use as default truth when available):
${stackCacheSummary}

Stack refresh required this round:
${input.includeStackSpecialist ? "yes" : "no"}

Planning rules:
1) Define a dynamic set of analysis agents based on this request. Do NOT rely on a fixed preset list.
2) Choose the smallest set that can still complete a high-quality pre-PRD in this round.
3) Jobs must be parallelizable and non-overlapping.
4) Return between ${MIN_DYNAMIC_DISCOVERY_AGENTS} and ${MAX_DYNAMIC_DISCOVERY_AGENTS} jobs unless context is trivial.
5) id must be short kebab-case and unique.
6) objective must be concrete and evidence-oriented.
7) If stack refresh required is "yes", exactly one job must set producesStackProfile=true.
8) If stack refresh required is "no", set producesStackProfile=false for all jobs and rely on cached stack where present.
`;

    let structuredOutput: unknown;
    let resultText = "";

    for await (const message of query({
      prompt: plannerPrompt,
      options: {
        ...baseOptions,
        model: this.getModel("discovery_specialist"),
        cwd: input.cwd,
        maxTurns: Math.max(6, Math.ceil(input.maxTurns * 0.45)),
        outputFormat: {
          type: "json_schema",
          schema: discoveryAgentPlanJsonSchema
        }
      }
    })) {
      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput = resultMessage.structured_output ?? tryParseStructuredOutputFromText(resultText);
      }
    }

    if (!structuredOutput) {
      throw new Error("Master discovery orchestrator produced no structured agent plan.");
    }

    const parsedPlan = discoveryAgentPlanSchema.parse(structuredOutput);
    const usedIds = new Set<string>();
    let jobs: SpecialistJob[] = parsedPlan.jobs.map((job, index) => ({
      id: allocateUniqueDiscoveryAgentId(job.id, index + 1, usedIds),
      title: job.title.trim(),
      objective: job.objective.trim(),
      producesStackProfile: Boolean(job.producesStackProfile)
    }));

    if (!input.includeStackSpecialist) {
      jobs = jobs.map((job) => ({ ...job, producesStackProfile: false }));
    } else {
      let stackAssigned = false;
      jobs = jobs.map((job) => {
        if (job.producesStackProfile && !stackAssigned) {
          stackAssigned = true;
          return { ...job, producesStackProfile: true };
        }
        return { ...job, producesStackProfile: false };
      });

      if (!stackAssigned) {
        const stackJob: SpecialistJob = {
          ...STACK_SPECIALIST_JOB,
          id: allocateUniqueDiscoveryAgentId(STACK_SPECIALIST_JOB.id, jobs.length + 1, usedIds),
          producesStackProfile: true
        };
        if (jobs.length >= MAX_DYNAMIC_DISCOVERY_AGENTS) {
          jobs[jobs.length - 1] = stackJob;
        } else {
          jobs.push(stackJob);
        }
      }
    }

    if (jobs.length < MIN_DYNAMIC_DISCOVERY_AGENTS) {
      for (const fallbackJob of FALLBACK_DYNAMIC_DISCOVERY_JOBS) {
        if (jobs.length >= MIN_DYNAMIC_DISCOVERY_AGENTS || jobs.length >= MAX_DYNAMIC_DISCOVERY_AGENTS) {
          break;
        }
        jobs.push({
          ...fallbackJob,
          id: allocateUniqueDiscoveryAgentId(fallbackJob.id, jobs.length + 1, usedIds),
          producesStackProfile: false
        });
      }
    }

    if (jobs.length === 0) {
      jobs = this.buildFallbackDiscoveryJobs(input.includeStackSpecialist);
    }

    if (jobs.length > MAX_DYNAMIC_DISCOVERY_AGENTS) {
      jobs = jobs.slice(0, MAX_DYNAMIC_DISCOVERY_AGENTS);
    }

    if (input.includeStackSpecialist && !jobs.some((job) => job.producesStackProfile)) {
      const usedTrimmedIds = new Set(jobs.map((job) => job.id));
      const stackJob: SpecialistJob = {
        ...STACK_SPECIALIST_JOB,
        id: allocateUniqueDiscoveryAgentId(STACK_SPECIALIST_JOB.id, jobs.length + 1, usedTrimmedIds),
        producesStackProfile: true
      };
      if (jobs.length >= MAX_DYNAMIC_DISCOVERY_AGENTS) {
        jobs[jobs.length - 1] = stackJob;
      } else {
        jobs.push(stackJob);
      }
    }

    return {
      jobs,
      rationale: parsedPlan.rationale.trim()
    };
  }

  private async runDiscoveryPrompt(
    prompt: string,
    cwd: string,
    maxTurns: number,
    callbacks?: DiscoveryCallbacks,
    options?: {
      projectPath?: string;
      includeStackSpecialist?: boolean;
      stackCache?: StackProfileCache | null;
      stackRefreshReason?: string | null;
      skipAnalysisRefresh?: boolean;
      carryForwardState?: DiscoveryInterviewState | null;
    }
  ): Promise<DiscoveryOutput> {
    const includeStackSpecialist = options?.includeStackSpecialist ?? true;
    const skipAnalysisRefresh = options?.skipAnalysisRefresh ?? false;
    const carryForwardState = options?.carryForwardState ?? null;

    if (options?.stackRefreshReason) {
      callbacks?.onEvent({
        type: "status",
        level: "info",
        message: options.stackRefreshReason
      });
    }

    if (options?.stackCache && !(options?.includeStackSpecialist ?? true)) {
      callbacks?.onEvent({
        type: "status",
        level: "info",
        message: this.stackProfileStore
          ? `Using cached stack profile from project profile store (updated ${new Date(options.stackCache.updatedAt).toLocaleString()}).`
          : `Using cached stack profile (${STACK_PROFILE_DIR}/${STACK_PROFILE_FILE}) from ${new Date(options.stackCache.updatedAt).toLocaleString()}.`
      });
    }

    let specialistSummary = "";
    let failedSpecialistSummary = "none";
    let stackReport: SpecialistAnalysis | null = null;

    if (skipAnalysisRefresh && carryForwardState) {
      callbacks?.onEvent({
        type: "status",
        level: "info",
        message:
          "No major context change detected. Reusing prior discovery context and skipping deep analysis refresh."
      });

      const carryForwardSnapshot = {
        objective: "Carry forward prior discovery context",
        producesStackProfile: false,
        summary: carryForwardState.directionSummary,
        findings: [],
        signals: carryForwardState.inferredContext.signals,
        painPoints: carryForwardState.inferredContext.painPoints,
        constraints: carryForwardState.inferredContext.constraints,
        scopeHints: [carryForwardState.inferredContext.scope],
        stackHints: [carryForwardState.inferredContext.stack],
        documentationHints: [carryForwardState.inferredContext.documentation],
        questions: carryForwardState.missingCriticalInfo,
        confidence: normalizeConfidencePercent(carryForwardState.readinessScore)
      };

      const summaries = [
        `### carried-context\n${JSON.stringify(carryForwardSnapshot, null, 2)}`
      ];
      if (options?.stackCache) {
        summaries.push(
          `### stack-cache\n` +
            JSON.stringify(
              {
                summary: options.stackCache.stackSummary,
                findings: [],
                signals: options.stackCache.signals,
                painPoints: [],
                constraints: [],
                scopeHints: [],
                stackHints: options.stackCache.stackHints,
                documentationHints: [],
                questions: [],
                confidence: options.stackCache.confidence
              },
              null,
              2
            )
        );
      }

      specialistSummary = summaries.join("\n\n");
    } else {
      callbacks?.onEvent({
        type: "status",
        level: "info",
        message: "Master orchestrator is planning discovery agents for this round..."
      });

      let selectedJobs: SpecialistJob[];
      try {
        const planned = await this.planDynamicDiscoveryJobs({
          prompt,
          cwd,
          maxTurns,
          callbacks,
          includeStackSpecialist,
          stackCache: options?.stackCache,
          projectPath: options?.projectPath
        });
        selectedJobs = planned.jobs;
        callbacks?.onEvent({
          type: "status",
          level: "info",
          message: `Master orchestrator selected ${selectedJobs.length} dynamic analysis agents.`
        });
        callbacks?.onEvent({
          type: "log",
          level: "info",
          message: `[orchestrator] ${planned.rationale}`
        });
      } catch (error) {
        selectedJobs = this.buildFallbackDiscoveryJobs(includeStackSpecialist);
        const details = error instanceof Error ? error.message : String(error);
        callbacks?.onEvent({
          type: "status",
          level: "error",
          message: "Dynamic agent planning failed; using fallback discovery agents.",
          details
        });
      }

      callbacks?.onEvent({
        type: "status",
        level: "info",
        message: `Launching ${selectedJobs.length} discovery analyses in parallel...`
      });

      const specialistTurns = Math.max(8, Math.ceil(maxTurns * 0.6));
      const specialistMaxAttempts = 2;

      const specialistOutcomes = await Promise.all(
        selectedJobs.map(async (job) => {
          let lastError = "Unknown specialist failure.";

          for (let attempt = 1; attempt <= specialistMaxAttempts; attempt += 1) {
            try {
              const result = await this.runSpecialistAnalysis({
                job,
                prompt,
                cwd,
                maxTurns: specialistTurns,
                callbacks,
                attempt,
                maxAttempts: specialistMaxAttempts
              });
              return {
                job,
                report: result.report,
                error: null,
                attemptsUsed: attempt
              };
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
              callbacks?.onEvent({
                type: "agent",
                level: "error",
                message: `Specialist attempt failed: ${job.id} (${attempt}/${specialistMaxAttempts})`,
                agent: job.id,
                details: lastError
              });
            }
          }

          return {
            job,
            report: null,
            error: lastError,
            attemptsUsed: specialistMaxAttempts
          };
        })
      );

      const completedReports: Array<{ job: SpecialistJob; report: SpecialistAnalysis }> = specialistOutcomes
        .filter((outcome) => outcome.report !== null)
        .map((outcome) => ({ job: outcome.job, report: outcome.report as SpecialistAnalysis }));
      const failedReports = specialistOutcomes.filter((outcome) => outcome.report === null);

      if (completedReports.length === 0) {
        throw new Error("All discovery analyses failed.");
      }

      if (failedReports.length > 0) {
        callbacks?.onEvent({
          type: "status",
          level: "error",
          message:
            `Discovery analyses finished with partial failures: ` +
            `${completedReports.length} succeeded, ${failedReports.length} failed. ` +
            "Synthesizing PRD input with available analyses."
        });
      } else {
        callbacks?.onEvent({
          type: "status",
          level: "info",
          message: `All discovery analyses completed (${completedReports.length}/${selectedJobs.length}). Synthesizing final PRD input...`
        });
      }

      stackReport = completedReports.find((entry) => entry.job.producesStackProfile)?.report ?? null;
      if (stackReport && options?.projectPath) {
        await this.writeStackProfileCache(options.projectPath, stackReport);
      }

      const specialistSummaries = completedReports.map(
          ({ job, report }) =>
            `### ${job.id} (${job.title})\n` +
            JSON.stringify(
              {
                objective: job.objective,
                producesStackProfile: job.producesStackProfile,
                summary: report.summary,
                findings: report.findings,
                signals: report.signals,
                painPoints: report.painPoints,
                constraints: report.constraints,
                scopeHints: report.scopeHints,
                stackHints: report.stackHints,
                documentationHints: report.documentationHints,
                questions: report.questions,
                confidence: report.confidence
              },
              null,
              2
            )
        );

      if (!stackReport && options?.stackCache) {
        specialistSummaries.push(
          `### stack-cache\n` +
            JSON.stringify(
              {
                summary: options.stackCache.stackSummary,
                findings: [],
                signals: options.stackCache.signals,
                painPoints: [],
                constraints: [],
                scopeHints: [],
                stackHints: options.stackCache.stackHints,
                documentationHints: [],
                questions: [],
                confidence: options.stackCache.confidence
              },
              null,
              2
            )
        );
      }

      specialistSummary = specialistSummaries.join("\n\n");
      failedSpecialistSummary =
        failedReports.length > 0
          ? failedReports
              .map((failed) => `- ${failed.job.id} (attempts: ${failed.attemptsUsed}): ${failed.error}`)
              .join("\n")
          : "none";
    }

    const synthesisPrompt = `
You are a senior PRD discovery synthesizer.

${prompt}

Dynamic analysis outputs (parallel):
${specialistSummary}

Failed analyses after retries:
${failedSpecialistSummary}

Synthesis requirements:
1) Merge analysis findings into one coherent direction summary.
2) Build inferredContext with practical stack/docs/scope/pain/constraints/signals.
3) Produce EXACTLY 3 high-impact clarification questions per round:
   - Every question MUST have question_type set to "multiple_choice".
   - Every question MUST have an "options" array with 4 to 5 distinct, actionable choices.
   - Every question MUST have a "recommendedOption" string that matches one of the options values exactly.
   - Every question MUST have a "selectionMode" of either "single" or "multi" depending on whether the user should pick one answer or can pick several.
   - Questions should be ordered by impact: most critical uncertainty first.
   - Do NOT produce text-only questions; all questions must be multiple-choice with concrete options.
   - Always return exactly 3 questions, even during continuation rounds with strong readiness.
4) Generate a polished prdInputDraft ready for plan generation.
5) readinessScore must reflect real confidence.
6) missingCriticalInfo must list blockers that can still change implementation decisions.
7) If any analysis failed, explicitly reflect uncertainty in missingCriticalInfo.
8) If stack-cache is present, treat it as the default stack truth unless new evidence contradicts it.
`;

    let structuredOutput: unknown;
    let resultText = "";
    let streamedText = "";
    let logBuffer = "";

    for await (const message of query({
      prompt: synthesisPrompt,
      options: {
        ...baseOptions,
        model: this.getModel("discovery_specialist"),
        cwd,
        maxTurns,
        includePartialMessages: true,
        outputFormat: {
          type: "json_schema",
          schema: discoveryOutputJsonSchema
        }
      }
    })) {
      const initMessage = message as { type?: string; subtype?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init") {
        callbacks?.onEvent({
          type: "status",
          level: "info",
          message: "Synthesis runtime initialized."
        });
      }

      const textChunk = extractTextDelta(message);
      if (textChunk) {
        streamedText += textChunk;
        logBuffer += textChunk;
        while (true) {
          const nextBreakIndex = logBuffer.indexOf("\n");
          if (nextBreakIndex === -1 && logBuffer.length < 220) {
            break;
          }

          const sliceAt = nextBreakIndex !== -1 && nextBreakIndex < 220 ? nextBreakIndex : 220;
          const part = logBuffer.slice(0, sliceAt).trim();
          logBuffer = logBuffer.slice(sliceAt + (sliceAt === nextBreakIndex ? 1 : 0));
          if (part.length > 0) {
            callbacks?.onEvent({
              type: "log",
              level: "info",
              message: `[synth] ${part}`
            });
          }
        }
      }

      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        callbacks?.onEvent({
          type: "status",
          level: "info",
          message: "Structured discovery output received. Validating..."
        });
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput =
          resultMessage.structured_output ??
          tryParseStructuredOutputFromText(resultText) ??
          tryParseStructuredOutputFromText(streamedText);
      }
    }

    const finalLog = logBuffer.trim();
    if (finalLog.length > 0) {
      callbacks?.onEvent({
        type: "log",
        level: "info",
        message: `[synth] ${finalLog}`
      });
    }

    if (!structuredOutput) {
      throw new Error("No structured discovery output received.");
    }

    const parsed = discoveryOutputSchema.parse(structuredOutput);

    // --- Post-processing: enforce exactly 3 questions per batch ---
    const BATCH_SIZE = 3;
    if (parsed.questions.length > BATCH_SIZE) {
      callbacks?.onEvent({
        type: "log",
        level: "info",
        message: `[synth] AI returned ${parsed.questions.length} questions; trimming to ${BATCH_SIZE}.`
      });
      parsed.questions = parsed.questions.slice(0, BATCH_SIZE);
    } else if (parsed.questions.length < BATCH_SIZE) {
      callbacks?.onEvent({
        type: "log",
        level: "info",
        message: `[synth] AI returned only ${parsed.questions.length} question(s); padding to ${BATCH_SIZE} with generic clarifiers.`
      });
      const FALLBACK_QUESTIONS: DiscoveryOutput["questions"] = [
        {
          id: "fallback-scope",
          question: "How would you describe the overall scope of this project?",
          reason: "Scope clarity helps narrow implementation decisions.",
          question_type: "multiple_choice",
          options: [
            "Small feature addition",
            "Medium feature set",
            "Large system overhaul",
            "Greenfield application"
          ],
          recommendedOption: "Medium feature set",
          selectionMode: "single"
        },
        {
          id: "fallback-priority",
          question: "What is most important for the first deliverable?",
          reason: "Prioritization drives task ordering in the plan.",
          question_type: "multiple_choice",
          options: [
            "Speed of delivery",
            "Code quality and maintainability",
            "Feature completeness",
            "User experience polish"
          ],
          recommendedOption: "Feature completeness",
          selectionMode: "single"
        },
        {
          id: "fallback-constraints",
          question: "Are there any hard constraints on this project?",
          reason: "Constraints materially affect architecture and implementation choices.",
          question_type: "multiple_choice",
          options: [
            "Must use existing tech stack only",
            "Strict deadline within 1–2 weeks",
            "Must maintain backward compatibility",
            "No significant constraints"
          ],
          recommendedOption: "No significant constraints",
          selectionMode: "multi"
        }
      ];
      const existingIds = new Set(parsed.questions.map((q) => q.id));
      for (const fallback of FALLBACK_QUESTIONS) {
        if (parsed.questions.length >= BATCH_SIZE) break;
        if (!existingIds.has(fallback.id)) {
          parsed.questions.push(fallback);
        }
      }
    }

    return parsed;
  }

  private async runSpecialistAnalysis(input: {
    job: SpecialistJob;
    prompt: string;
    cwd: string;
    maxTurns: number;
    callbacks?: DiscoveryCallbacks;
    attempt?: number;
    maxAttempts?: number;
  }): Promise<{ job: SpecialistJob; report: SpecialistAnalysis }> {
    const attempt = input.attempt ?? 1;
    const maxAttempts = input.maxAttempts ?? 1;
    input.callbacks?.onEvent({
      type: "agent",
      level: "info",
      message: `Starting specialist agent: ${input.job.id}`,
      agent: input.job.id,
      details: `${input.job.title} (attempt ${attempt}/${maxAttempts})`
    });

    const specialistPrompt = `
You are specialist agent "${input.job.id}".

${input.prompt}

Specialist objective:
${input.job.objective}

Output requirements:
- Return structured JSON only.
- Do not use markdown fences or commentary outside JSON.
- Required top-level keys: summary, findings, signals, painPoints, constraints, scopeHints, stackHints, documentationHints, questions, confidence.
- Be concrete and evidence-oriented.
- Prefer repository signals when a project path exists.
- Include unresolved questions that materially affect implementation decisions.
`;

    let structuredOutput: unknown;
    let resultText = "";
    let streamedText = "";
    let logBuffer = "";

    for await (const message of query({
      prompt: specialistPrompt,
      options: {
        ...baseOptions,
        model: this.getModel("discovery_specialist"),
        cwd: input.cwd,
        maxTurns: input.maxTurns,
        includePartialMessages: true,
        outputFormat: {
          type: "json_schema",
          schema: specialistAnalysisJsonSchema
        }
      }
    })) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        streamedText += textChunk;
        logBuffer += textChunk;
        while (true) {
          const nextBreakIndex = logBuffer.indexOf("\n");
          if (nextBreakIndex === -1 && logBuffer.length < 220) {
            break;
          }

          const sliceAt = nextBreakIndex !== -1 && nextBreakIndex < 220 ? nextBreakIndex : 220;
          const part = logBuffer.slice(0, sliceAt).trim();
          logBuffer = logBuffer.slice(sliceAt + (sliceAt === nextBreakIndex ? 1 : 0));
          if (part.length > 0) {
            input.callbacks?.onEvent({
              type: "log",
              level: "info",
              message: `[${input.job.id}] ${part}`,
              agent: input.job.id
            });
          }
        }
      }

      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput =
          resultMessage.structured_output ??
          tryParseStructuredOutputFromText(resultText) ??
          tryParseStructuredOutputFromText(streamedText);
      }
    }

    const finalLog = logBuffer.trim();
    if (finalLog.length > 0) {
      input.callbacks?.onEvent({
        type: "log",
        level: "info",
        message: `[${input.job.id}] ${finalLog}`,
        agent: input.job.id
      });
    }

    if (!structuredOutput) {
      throw new Error(`${input.job.id} produced no structured output.`);
    }

    const parsedReport = specialistAnalysisSchema.parse(structuredOutput);
    const report: SpecialistAnalysis = {
      ...parsedReport,
      confidence: normalizeConfidencePercent(parsedReport.confidence)
    };
    input.callbacks?.onEvent({
      type: "agent",
      level: "info",
      message: `Completed specialist agent: ${input.job.id} (${report.confidence}% confidence)`,
      agent: input.job.id
    });

    return {
      job: input.job,
      report
    };
  }

  async inferStack(input: InferStackInput): Promise<InferStackResult> {
    const normalizedPath = input.projectPath.trim();
    const cwd =
      input.projectMode === "existing" && normalizedPath.length > 0
        ? resolveQueryCwd(normalizedPath)
        : process.cwd();

    const prompt =
      input.projectMode === "existing"
        ? `
You are a software architecture analyst.

Task: infer the real technology stack from this existing codebase and recommend the best stack summary for PRD planning.

Inputs:
- projectPath: ${normalizedPath || "(not provided)"}
- projectGoal: ${input.projectGoal}
- constraints: ${input.constraints || "none"}
- currentStackHint: ${input.currentStack || "none"}

Instructions:
1) Inspect repository signals (configs, manifests, lockfiles, src structure) before concluding.
2) Return one recommendedStack string suitable for a PRD.
3) Include detectedSignals that justify your conclusion.
4) Provide alternatives only if uncertainty exists.
5) Include follow-up questions when critical info is missing.
6) Use the "stack-architect" subagent via Task for focused analysis.
`
        : `
You are a software architecture advisor for a new project.

Task: suggest the most suitable initial stack based on product intent and constraints.

Inputs:
- projectGoal: ${input.projectGoal}
- constraints: ${input.constraints || "none"}
- currentStackHint: ${input.currentStack || "none"}

Instructions:
1) Recommend one default stack with practical rationale.
2) Provide 2-3 alternatives with tradeoffs.
3) Ask high-impact follow-up questions to clarify needs/wants.
4) Include confidence score.
5) Use the "stack-architect" subagent via Task for focused reasoning.
`;

    let structuredOutput: unknown;
    let resultText = "";

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
        model: this.getModel("plan_synthesis"),
        cwd,
        maxTurns: 10,
        outputFormat: {
          type: "json_schema",
          schema: inferStackJsonSchema
        },
        agents: {
          "stack-architect": {
            description: "Architecture specialist for stack selection and codebase stack inference.",
            prompt: `
You infer technology stacks from code artifacts and recommend pragmatic defaults.
Prefer concrete evidence and practical tradeoffs.
`
          }
        }
      }
    })) {
      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput = resultMessage.structured_output ?? tryParseStructuredOutputFromText(resultText);
      }
    }

    if (!structuredOutput) {
      throw new Error("No structured stack inference output received.");
    }

    return inferStackSchema.parse(structuredOutput);
  }

  async getWizardGuidance(input: GetWizardGuidanceInput): Promise<WizardGuidanceResult> {
    const allStepsSummary = input.allSteps
      .map(
        (step, index) =>
          `${index + 1}. [${step.stepId}] ${step.title}\nGoal: ${step.goal}\nAnswer: ${step.currentData}\nNote: ${
            step.note || "none"
          }`
      )
      .join("\n\n");

    const prompt = `
You are an interactive PRD planning coach.

You must help users build a complete, high-quality PRD prompt step by step.
Focus only on the current step, but use all prior steps for consistency.

Current step:
- stepId: ${input.step.stepId}
- title: ${input.step.title}
- goal: ${input.step.goal}
- currentData: ${input.step.currentData}
- note: ${input.step.note || "none"}

All steps summary:
${allStepsSummary}

Draft prompt so far:
---
${input.draftPrompt}
---

Instructions:
1) Ask one high-impact next question that unlocks better technical decisions.
2) Provide a concrete recommendation for this step (not generic advice).
3) Explain rationale and tradeoff briefly.
4) Score completeness 0-100 for this step only.
5) List missing points that should be added before finalizing.
6) Provide a polished prompt fragment the user can paste into the PRD prompt.
7) Provide suggestedEdits with explicit field names from the step data when possible.

Important:
- Keep output concise and actionable.
- Avoid repeating the entire PRD.
- Treat this as an iterative interview.
- Use the "prd-interviewer" agent via Task to reason deeply before returning final guidance.
`;

    const cwd = input.projectPath.trim().length > 0 ? input.projectPath : process.cwd();
    let structuredOutput: unknown;
    let resultText = "";

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
        model: this.getModel("plan_synthesis"),
        cwd,
        maxTurns: 8,
        outputFormat: {
          type: "json_schema",
          schema: wizardGuidanceJsonSchema
        },
        agents: {
          "prd-interviewer": {
            description:
              "PRD interviewer agent specialized in extracting missing product and technical context.",
            prompt: `
You are a PRD interviewing specialist.
Given a current step and previous context, produce precise guidance that improves plan quality.
Optimize for actionable, implementation-ready outcomes.
`
          }
        }
      }
    })) {
      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput = resultMessage.structured_output ?? tryParseStructuredOutputFromText(resultText);
      }
    }

    if (!structuredOutput) {
      throw new Error("No structured wizard guidance output received.");
    }

    return wizardGuidanceSchema.parse(structuredOutput);
  }

  async createPlan(args: CreatePlanArgs): Promise<CreatePlanResult> {
    const cwd = resolveQueryCwd(args.projectPath);
    const projectHistoryContext = args.projectHistoryContext?.trim() ?? "";
    const prompt = `
You are a Ralph planning engine for strict single-task execution.

Generate a complete technical plan from this PRD text:
---
${args.prdText}
---

Project history context (same project path, optional):
${projectHistoryContext.length > 0 ? projectHistoryContext : "none"}

Output MUST match the provided JSON schema exactly.

Rules:
- Build an implementation checklist where each item is atomic and can be done in exactly one Ralph iteration.
- Dependencies must use checklist item IDs.
- Acceptance criteria must be testable.
- Keep architecture notes practical and implementation-focused.
- Include realistic risks, assumptions, and test strategy.
- Avoid duplicating already-completed scope from project history unless the PRD explicitly requests it.
`;

    let structuredOutput: unknown;
    let resultText = "";

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
        model: this.getModel("plan_synthesis"),
        cwd,
        includePartialMessages: true,
        maxTurns: 10,
        outputFormat: {
          type: "json_schema",
          schema: technicalPackJsonSchema
        }
      }
    })) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        args.onLog?.(textChunk);
      }

      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput = resultMessage.structured_output ?? tryParseStructuredOutputFromText(resultText);
      }
    }

    if (!structuredOutput) {
      throw new Error("No structured output received while creating the Ralph plan.");
    }

    const technicalPack = technicalPackSchema.parse(structuredOutput);
    return {
      summary: technicalPack.summary,
      technicalPack
    };
  }

  async runTask(args: RunTaskArgs): Promise<RunTaskResult> {
    const cwd = resolveQueryCwd(args.workingDirectory ?? args.plan.projectPath);
    const taskModel = this.getModel("task_execution");
    const architectureModel = this.getModel("architecture_specialist");
    const testerModel = this.getModel("tester");
    const committerModel = this.getModel("committer");
    const clearResponse = query({
      prompt: "/clear",
      options: {
        ...baseOptions,
        model: taskModel,
        cwd,
        maxTurns: 1
      }
    });

    let clearSessionId: string | null = null;
    for await (const message of clearResponse) {
      const initMessage = message as { type?: string; subtype?: string; session_id?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
        clearSessionId = initMessage.session_id;
      }
    }

    if (!clearSessionId) {
      throw new Error("Unable to start a cleared task session.");
    }

    let runSessionId: string | null = clearSessionId;
    let totalDurationMs = 0;
    let totalCostUsd = 0;
    let hasCost = false;
    const finalSections: string[] = [];

    const initialHead = await readGitHeadCommit(cwd);
    if (!initialHead) {
      throw new Error("Unable to determine current git HEAD for task execution.");
    }
    const strictHeadGuard = Boolean(args.branchName);
    let expectedHead = initialHead;

    const ensureNoCommitYet = async (stageLabel: string): Promise<void> => {
      const currentHead = await readGitHeadCommit(cwd);
      if (!currentHead || currentHead === expectedHead) {
        return;
      }

      if (strictHeadGuard) {
        throw new Error(
          `Runtime policy violation: git HEAD changed before committer stage (${stageLabel}). expected=${expectedHead}, current=${currentHead}.`
        );
      }

      args.callbacks.onLog(
        `\n[policy] Shared-checkout HEAD drift detected before committer stage (${stageLabel}). ` +
        `expected=${expectedHead}, current=${currentHead}. Continuing and rebasing guard baseline.\n`
      );
      expectedHead = currentHead;
    };

    const runStage = async (input: {
      stageName: string;
      prompt: string;
      model: string;
      maxTurns: number;
      outputSchema?: Record<string, unknown>;
      agents?: NonNullable<Options["agents"]>;
    }): Promise<{
      resultText: string;
      stopReason: string | null;
      durationMs: number | null;
      totalCostUsd: number | null;
      structuredOutput?: unknown;
    }> => {
      const agentRole = mapStageToAgentRole(input.stageName);
      args.callbacks.onLog(`\n[stage] ${input.stageName} started\n`);
      args.callbacks.onSubagent({
        kind: "agent_stage",
        stage: input.stageName,
        agentRole,
        status: "started",
        summary: `${input.stageName} started`
      });

      try {
        const isCommitterStage = agentRole === "committer";
        const options: Options = {
          ...baseOptions,
          model: input.model,
          cwd,
          resume: runSessionId ?? clearSessionId,
          includePartialMessages: true,
          maxTurns: input.maxTurns,
          canUseTool: async (toolName, toolInput) => {
            if (toolName !== "Bash") {
              return { behavior: "allow" };
            }

            const commandText = extractBashCommand(toolInput);

            if (!isCommitterStage && MUTATING_GIT_COMMAND_PATTERN.test(commandText)) {
              return {
                behavior: "deny",
                message:
                  `Runtime policy: ${input.stageName} cannot execute mutating git commands. ` +
                  "Only the committer stage may perform git state mutations."
              };
            }

            if (isCommitterStage && GIT_MERGE_COMMAND_PATTERN.test(commandText)) {
              return {
                behavior: "deny",
                message:
                  "Runtime policy: committer task stage cannot run git merge. " +
                  "Merges are only allowed in the dedicated phase-merge committer flow."
              };
            }

            return { behavior: "allow" };
          }
        };

        if (input.agents) {
          options.agents = input.agents;
        }

        if (input.outputSchema) {
          options.outputFormat = {
            type: "json_schema",
            schema: input.outputSchema
          };
        }

        const response = query({
          prompt: input.prompt,
          options
        });

        args.callbacks.onQuery(response);

        let resultText = "";
        let stopReason: string | null = null;
        let stageDurationMs: number | null = null;
        let stageCostUsd: number | null = null;
        let structuredOutput: unknown;

        for await (const message of response) {
          const textChunk = extractTextDelta(message);
          if (textChunk) {
            args.callbacks.onLog(textChunk);
          }

          const initMessage = message as { type?: string; subtype?: string; session_id?: string };
          if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
            runSessionId = initMessage.session_id;
            args.callbacks.onSession(runSessionId);
          }

          const blocks = extractAssistantToolBlocks(message);
          for (const block of blocks) {
            if (block.type !== "tool_use" || !block.name) {
              continue;
            }

            if (block.name === "TodoWrite") {
              const toolInput = block.input as { todos?: TodoItem[] } | undefined;
              if (Array.isArray(toolInput?.todos)) {
                args.callbacks.onTodo(toolInput.todos);
              }
            }

            if (block.name === "Task") {
              const invocation = parseTaskToolInvocation(block.input);
              if (invocation) {
                args.callbacks.onLog(
                  `\n[subagent-spawn] stage=${input.stageName} subagent=${invocation.subagentType} description=${JSON.stringify(invocation.description)}\n`
                );
                args.callbacks.onLog(`[subagent-spawn-prompt] ${JSON.stringify(invocation.prompt)}\n`);
              }

              args.callbacks.onSubagent({
                stage: input.stageName,
                ...(typeof block.input === "object" && block.input ? (block.input as Record<string, unknown>) : {})
              });
            }
          }

          const resultMessage = message as {
            type?: string;
            result?: string;
            stop_reason?: string | null;
            duration_ms?: number;
            total_cost_usd?: number;
            structured_output?: unknown;
          };
          if (resultMessage.type === "result") {
            resultText = resultMessage.result ?? "";
            stopReason = resultMessage.stop_reason ?? null;
            stageDurationMs = resultMessage.duration_ms ?? null;
            stageCostUsd = resultMessage.total_cost_usd ?? null;
            structuredOutput = resultMessage.structured_output;
          }
        }

        totalDurationMs += stageDurationMs ?? 0;
        if (stageCostUsd !== null) {
          totalCostUsd += stageCostUsd;
          hasCost = true;
        }

        if (resultText.trim().length > 0) {
          finalSections.push(`## ${input.stageName}\n${resultText.trim()}`);
        }

        args.callbacks.onLog(`\n[stage] ${input.stageName} completed\n`);
        args.callbacks.onSubagent({
          kind: "agent_stage",
          stage: input.stageName,
          agentRole,
          status: "completed",
          summary: resultText.trim().slice(0, 400),
          stopReason: stopReason ?? undefined
        });

        return {
          resultText,
          stopReason,
          durationMs: stageDurationMs,
          totalCostUsd: stageCostUsd,
          structuredOutput
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        args.callbacks.onSubagent({
          kind: "agent_stage",
          stage: input.stageName,
          agentRole,
          status: "failed",
          summary: message.slice(0, 400)
        });
        throw error;
      }
    };

    const retryInjection = args.retryContext
      ? `\nPrevious attempt failed: ${args.retryContext.previousError}\nRetry attempt: #${args.retryContext.retryCount}\n`
      : "";
    const worktreeInjection = args.branchName
      ? `\nExecution context: cwd=${cwd}, branch=${args.branchName}, phase=${args.phaseNumber ?? "n/a"}\n`
      : "";
    const planProgressContext =
      args.planProgressContext && args.planProgressContext.trim().length > 0
        ? args.planProgressContext.trim()
        : "No prior progress entries have been recorded for this plan.";
    const taskContext = `
Plan summary:
${args.plan.summary}

PRD:
${args.plan.prdText}

Plan progress history:
${planProgressContext}

Task:
- id: ${args.task.id}
- title: ${args.task.title}
- description: ${args.task.description}
- dependencies completed: ${args.task.dependencies.length > 0 ? args.task.dependencies.join(", ") : "none"}

Technical notes:
${args.task.technicalNotes}
`;

    await runStage({
      stageName: "implementation",
      model: taskModel,
      maxTurns: 40,
      agents: {
        "ralph-worker": {
          description:
            "Strict implementation worker for one task. Never run git commit or git merge.",
          prompt: `
You implement only the requested task.
Stay in scope, update code, and prepare for architecture review.
Do NOT run git commit or git merge.
`
        }
      },
      prompt: `
You are running stage: implementation.
${retryInjection}
${worktreeInjection}
${taskContext}

Instructions:
1) Use the in-prompt PRD and plan progress history as authoritative context.
2) Implement only this task.
3) Keep code changes scoped and production-safe.
4) Do NOT run git commit or git merge.
5) Return concise changed-files summary.
`
    });
    await ensureNoCommitYet("implementation");

    let architectureReviewIteration = 0;
    let lastArchitectureReview: ArchitectureReview | null = null;

    while (true) {
      architectureReviewIteration += 1;

      const reviewResult = await runStage({
        stageName: `architecture-review-${architectureReviewIteration}`,
        model: architectureModel,
        maxTurns: 16,
        outputSchema: architectureReviewJsonSchema,
        prompt: `
You are running stage: architecture-review.
${taskContext}

Return ONLY valid JSON for this schema.

Review objectives:
- Check if the task changes are in the right service/module.
- Enforce SOLID with strong SRP focus.
- Detect duplicate code and suggest safe DRY refactors.
- Recommend concrete refactor actions when needed.

Status policy:
- pass: zero findings and no actionable quality issue.
- pass_with_notes: only non-critical notes with no required code changes.
- needs_refactor: any structural/code-quality issue that should be fixed before testing.
- blocked: critical issue that prevents safe continuation.

Quality gate rules (strict):
- Any critical finding => blocked.
- Any high finding => needs_refactor or blocked.
- Any medium finding on boundary/srp/duplication/solid => needs_refactor.
- If findings exist, recommendedActions must be concrete and non-empty.
`
      });

      const parsedReview = architectureReviewSchema.parse(reviewResult.structuredOutput);
      const review = enforceArchitectureQualityGate(parsedReview);
      lastArchitectureReview = review;
      args.callbacks.onSubagent({
        kind: "architecture_review",
        iteration: architectureReviewIteration,
        maxIterations: MAX_ARCH_REFACTOR_CYCLES,
        review
      });

      if (review.status === "pass" || review.status === "pass_with_notes") {
        break;
      }

      if (review.status === "blocked") {
        throw new Error(
          `Architecture review blocked execution: ${review.summary}\n${summarizeArchitectureFindings(review)}`
        );
      }

      if (architectureReviewIteration >= MAX_ARCH_REFACTOR_CYCLES) {
        throw new Error(
          `Architecture review still requires refactor after ${MAX_ARCH_REFACTOR_CYCLES} cycle(s): ${review.summary}`
        );
      }

      await runStage({
        stageName: `architecture-refactor-${architectureReviewIteration}`,
        model: taskModel,
        maxTurns: 28,
        agents: {
          "ralph-worker": {
            description:
              "Focused refactor worker for architecture findings. Never run git commit or git merge.",
            prompt: `
Apply only targeted refactors from architecture findings.
Do not widen scope.
Do NOT run git commit or git merge.
`
          }
        },
        prompt: `
You are running stage: architecture-refactor.
${taskContext}

Architecture findings to fix now:
${summarizeArchitectureFindings(review)}

Recommended actions:
${review.recommendedActions.length > 0 ? review.recommendedActions.join("\n") : "- none provided"}

Instructions:
1) Apply only necessary refactors to resolve findings.
2) Preserve task scope and behavior.
3) Do NOT run git commit or git merge.
4) Return concise summary of refactors.
`
      });
      await ensureNoCommitYet(`architecture-refactor-${architectureReviewIteration}`);
    }

    await ensureNoCommitYet("architecture-gate-complete");

    await runStage({
      stageName: "tester",
      model: testerModel,
      maxTurns: 28,
      prompt: `
You are running stage: tester.
${taskContext}

Testing policy (strict):
1) Prefer integration/e2e/system tests in real runtime conditions whenever available.
2) If integration tests are not feasible, run strongest fallback and explain why.
3) Unit tests are fallback-only.
4) Provide commands run and pass/fail evidence.
5) Do NOT run git commit or git merge.
`
    });
    await ensureNoCommitYet("tester");

    const headBeforeCommitter = await readGitHeadCommit(cwd);
    if (!headBeforeCommitter) {
      throw new Error("Unable to determine HEAD before committer stage.");
    }

    const committerResult = await runStage({
      stageName: "committer",
      model: committerModel,
      maxTurns: 24,
      prompt: `
You are running stage: committer.
${taskContext}
${worktreeInjection}

Commit policy (strict):
1) Review current diff and ensure task scope is respected.
2) Create commit(s) using Conventional Commits:
   <type>[optional scope]: <description>
3) Allowed examples: feat, fix, docs, refactor, test, chore, perf, improvement.
4) Never include "Co-authored-by" trailer mentioning Claude.
5) Do NOT run git merge in this stage.
6) Return commit hash(es) and commit message(s).
`
    });

    const headAfterCommitter = await readGitHeadCommit(cwd);
    if (!headAfterCommitter || headAfterCommitter === headBeforeCommitter) {
      throw new Error("Runtime policy violation: committer stage completed without creating a commit.");
    }

    await validateCommitPolicyForRange(
      cwd,
      `${headBeforeCommitter}..${headAfterCommitter}`,
      `task ${args.task.id} committer stage`
    );

    args.callbacks.onSubagent({
      kind: "committer_summary",
      headBefore: headBeforeCommitter,
      headAfter: headAfterCommitter
    });

    if (lastArchitectureReview) {
      finalSections.push(
        `## architecture-gate-summary\nstatus: ${lastArchitectureReview.status}\nsummary: ${lastArchitectureReview.summary}`
      );
    }

    return {
      sessionId: runSessionId,
      resultText: finalSections.join("\n\n"),
      stopReason: committerResult.stopReason,
      durationMs: totalDurationMs > 0 ? totalDurationMs : null,
      totalCostUsd: hasCost ? totalCostUsd : null
    };
  }

  async mergePhaseWithCommitter(args: MergePhaseArgs): Promise<MergePhaseResult> {
    const cwd = resolveQueryCwd(args.repoRoot);
    const committerModel = this.getModel("committer");

    const clearResponse = query({
      prompt: "/clear",
      options: {
        ...baseOptions,
        model: committerModel,
        cwd,
        maxTurns: 1
      }
    });

    let clearSessionId: string | null = null;
    for await (const message of clearResponse) {
      const initMessage = message as { type?: string; subtype?: string; session_id?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
        clearSessionId = initMessage.session_id;
      }
    }

    if (!clearSessionId) {
      throw new Error("Unable to start a cleared committer session for phase merge.");
    }

    const mergeContext =
      typeof args.mergeContextSummary === "string" && args.mergeContextSummary.trim().length > 0
        ? args.mergeContextSummary.trim()
        : "No additional merge context provided.";
    const validationCommands =
      Array.isArray(args.validationCommands) && args.validationCommands.length > 0
        ? args.validationCommands.map((command, index) => `${index + 1}. ${command}`).join("\n")
        : "(none)";

    const mergePrompt = `
You are the dedicated Ralph committer agent for queue merge.

Repository root: ${cwd}
Target branch: ${args.targetBranch}
Phase number: ${args.phaseNumber}
Branches to merge in order:
${args.branches.map((branch, index) => `${index + 1}. ${branch}`).join("\n")}

Merge context (task intent + execution outcomes):
${mergeContext}

Validation commands (must all pass before you finish):
${validationCommands}

Merge policy (strict):
1) Verify working tree is clean before merging.
2) Checkout the target branch.
3) Merge each branch in listed order using no-fast-forward merge commits.
4) Merge commit messages MUST follow Conventional Commits:
   <type>[optional scope]: <description>
5) Never include any Co-authored-by trailer that mentions Claude.
6) If a merge conflict occurs, resolve it using the merge context above:
   - preserve intended behavior of already-merged work on target branch
   - preserve the incoming task's stated acceptance criteria
   - keep fixes minimal and scoped to conflict/integration correctness
7) After merges, run every validation command. If a command fails, make minimal integration fixes, commit with Conventional Commits, and rerun until all pass or truly blocked.
8) If blocked, report concrete blockers (files + why) and leave the repo in a clean, non-conflicted state.
9) Provide a concise summary of merged branches, conflict resolutions, validation command results, and resulting commit hashes.

You are the only agent allowed to run git merge in this step.
`;

    let sessionId: string | null = clearSessionId;
    let resultText = "";
    let stopReason: string | null = null;

    const mergeResponse = query({
      prompt: mergePrompt,
      options: {
        ...baseOptions,
        model: committerModel,
        cwd,
        resume: clearSessionId,
        includePartialMessages: true,
        maxTurns: 80
      }
    });

    args.callbacks.onQuery(mergeResponse);

    for await (const message of mergeResponse) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        args.callbacks.onLog(textChunk);
      }

      const initMessage = message as { type?: string; subtype?: string; session_id?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
        sessionId = initMessage.session_id;
      }

      const resultMessage = message as {
        type?: string;
        result?: string;
        stop_reason?: string | null;
      };
      if (resultMessage.type === "result") {
        resultText = resultMessage.result ?? "";
        stopReason = resultMessage.stop_reason ?? null;
      }
    }

    return {
      sessionId,
      resultText,
      stopReason
    };
  }

  async stabilizePhaseIntegrationWithCommitter(
    args: StabilizePhaseIntegrationArgs
  ): Promise<StabilizePhaseIntegrationResult> {
    const cwd = resolveQueryCwd(args.repoRoot);
    const committerModel = this.getModel("committer");

    const clearResponse = query({
      prompt: "/clear",
      options: {
        ...baseOptions,
        model: committerModel,
        cwd,
        maxTurns: 1
      }
    });

    let clearSessionId: string | null = null;
    for await (const message of clearResponse) {
      const initMessage = message as { type?: string; subtype?: string; session_id?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
        clearSessionId = initMessage.session_id;
      }
    }

    if (!clearSessionId) {
      throw new Error("Unable to start a cleared committer session for phase stabilization.");
    }

    const contextSummary =
      typeof args.phaseContextSummary === "string" && args.phaseContextSummary.trim().length > 0
        ? args.phaseContextSummary.trim()
        : "No additional phase context provided.";
    const validationCommands =
      Array.isArray(args.validationCommands) && args.validationCommands.length > 0
        ? args.validationCommands.map((command, index) => `${index + 1}. ${command}`).join("\n")
        : "(none)";

    const stabilizePrompt = `
You are the dedicated Ralph committer agent for phase integration stabilization.

Repository root: ${cwd}
Phase number: ${args.phaseNumber}
Integration branch: ${args.integrationBranch}
Target branch for promotion: ${args.targetBranch}

Phase context (what was intended + what already landed):
${contextSummary}

Validation commands:
${validationCommands}

Stabilization policy (strict):
1) Checkout ${args.integrationBranch}.
2) If any merge/cherry-pick/rebase conflict state exists, resolve it or cleanly abort the operation. Never leave the repository conflicted.
3) Review integration diff relative to ${args.targetBranch}; keep changes minimal and aligned with phase intent.
4) Run all validation commands. If any fail, make minimal integration fixes, commit with Conventional Commits, and rerun until all pass or truly blocked.
5) Never include any Co-authored-by trailer that mentions Claude.
6) Before finishing, ensure git status is clean and branch is ready for fast-forward promotion.
7) Provide a concise summary of fixes, validations, and resulting commit hashes.
`;

    let sessionId: string | null = clearSessionId;
    let resultText = "";
    let stopReason: string | null = null;

    const stabilizeResponse = query({
      prompt: stabilizePrompt,
      options: {
        ...baseOptions,
        model: committerModel,
        cwd,
        resume: clearSessionId,
        includePartialMessages: true,
        maxTurns: 90
      }
    });

    args.callbacks.onQuery(stabilizeResponse);

    for await (const message of stabilizeResponse) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        args.callbacks.onLog(textChunk);
      }

      const initMessage = message as { type?: string; subtype?: string; session_id?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
        sessionId = initMessage.session_id;
      }

      const resultMessage = message as {
        type?: string;
        result?: string;
        stop_reason?: string | null;
      };
      if (resultMessage.type === "result") {
        resultText = resultMessage.result ?? "";
        stopReason = resultMessage.stop_reason ?? null;
      }
    }

    return {
      sessionId,
      resultText,
      stopReason
    };
  }
}
