/**
 * DiscoveryAgent — standalone class encapsulating the entire discovery flow.
 *
 * Extracted from RalphAgentService to satisfy the god-class decomposition
 * target in Track 1 of the v0.2.0 PRD.
 *
 * Responsibilities:
 * - startDiscovery / continueDiscovery interview loop
 * - Dynamic specialist orchestration (planDynamicDiscoveryJobs)
 * - Parallel specialist analysis (runSpecialistAnalysis)
 * - Synthesis prompt (runDiscoveryPrompt)
 * - Stack profile caching (read / write / resolve)
 * - Context-change heuristics (shouldRefreshStackAnalysis, shouldForceFullDiscoveryRefresh)
 * - Stack inference (inferStack)
 * - Fallback job generation (buildFallbackDiscoveryJobs)
 * - Stack profile refresh (refreshStackProfile)
 *
 * Dependencies are injected via constructor:
 * - `ModelResolver` function to resolve agent-role → model-id
 * - Optional `StackProfileStore` for custom persistence
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DiscoveryAnswer,
  DiscoveryInterviewState,
  InferStackInput,
  InferStackResult
} from "@shared/types";
import {
  baseOptions,
  DISCOVERY_CONTEXT_CHANGE_HINT_PATTERN,
  FALLBACK_DYNAMIC_DISCOVERY_JOBS,
  FULL_DISCOVERY_REFRESH_TOKEN_PATTERN,
  MAX_DYNAMIC_DISCOVERY_AGENTS,
  MIN_DYNAMIC_DISCOVERY_AGENTS,
  type ModelResolver,
  STACK_CHANGE_HINT_PATTERN,
  STACK_PROFILE_DIR,
  STACK_PROFILE_FILE,
  STACK_REFRESH_TOKEN_PATTERN,
  STACK_SPECIALIST_ID,
  STACK_SPECIALIST_JOB,
  type SpecialistJob
} from "./agent-constants";
import {
  discoveryAgentPlanJsonSchema,
  discoveryAgentPlanSchema,
  discoveryOutputJsonSchema,
  discoveryOutputSchema,
  inferStackJsonSchema,
  inferStackSchema,
  specialistAnalysisJsonSchema,
  specialistAnalysisSchema,
  stackProfileCacheSchema
} from "./agent-schemas";
import {
  allocateUniqueDiscoveryAgentId,
  extractTextDelta,
  formatAnswers,
  normalizeConfidencePercent,
  resolveQueryCwd,
  tryParseStructuredOutputFromText
} from "./agent-utils";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiscoveryOutput {
  directionSummary: string;
  inferredContext: DiscoveryInterviewState["inferredContext"];
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

export interface DiscoveryStreamEvent {
  type: "status" | "log" | "agent";
  level: "info" | "error";
  message: string;
  agent?: string;
  details?: string;
}

export interface DiscoveryCallbacks {
  onEvent: (event: DiscoveryStreamEvent) => void;
}

export interface StartDiscoveryArgs {
  projectPath: string;
  seedSentence: string;
  additionalContext: string;
  callbacks?: DiscoveryCallbacks;
}

export interface ContinueDiscoveryArgs extends StartDiscoveryArgs {
  answerHistory: DiscoveryAnswer[];
  latestAnswers: DiscoveryAnswer[];
  previousState?: DiscoveryInterviewState | null;
  stackRefreshContext?: string;
}

export interface SpecialistAnalysis {
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

export type { ModelResolver } from "./agent-constants";

// ---------------------------------------------------------------------------
// DiscoveryAgent class
// ---------------------------------------------------------------------------

export class DiscoveryAgent {
  private readonly getModel: ModelResolver;
  private readonly stackProfileStore?: StackProfileStore;

  constructor(getModel: ModelResolver, stackProfileStore?: StackProfileStore) {
    this.getModel = getModel;
    this.stackProfileStore = stackProfileStore;
  }

  // -------------------------------------------------------------------------
  // Stack profile cache I/O
  // -------------------------------------------------------------------------

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

  /**
   * Formats a cached stack profile as a `### stack-cache` markdown block with
   * pretty-printed JSON matching the specialist analysis shape.
   */
  private formatStackCacheSummary(cache: StackProfileCache): string {
    return (
      `### stack-cache\n` +
      JSON.stringify(
        {
          summary: cache.stackSummary,
          findings: [],
          signals: cache.signals,
          painPoints: [],
          constraints: [],
          scopeHints: [],
          stackHints: cache.stackHints,
          documentationHints: [],
          questions: [],
          confidence: cache.confidence
        },
        null,
        2
      )
    );
  }

  // -------------------------------------------------------------------------
  // Context-change heuristics
  // -------------------------------------------------------------------------

  /**
   * Combines additional context and latest discovery answers into a single
   * string for pattern matching, filtering out blank entries.
   * Returns an empty string when there is no meaningful content.
   */
  private buildCombinedContext(additionalContext: string, latestAnswers: DiscoveryAnswer[]): string {
    return [additionalContext, ...latestAnswers.map((entry) => entry.answer)]
      .filter((value) => value.trim().length > 0)
      .join("\n");
  }

  private shouldRefreshStackAnalysis(additionalContext: string, latestAnswers: DiscoveryAnswer[]): boolean {
    const combined = this.buildCombinedContext(additionalContext, latestAnswers);
    return combined.length > 0 && (STACK_REFRESH_TOKEN_PATTERN.test(combined) || STACK_CHANGE_HINT_PATTERN.test(combined));
  }

  private shouldForceFullDiscoveryRefresh(additionalContext: string, latestAnswers: DiscoveryAnswer[]): boolean {
    const combined = this.buildCombinedContext(additionalContext, latestAnswers);
    return combined.length > 0 && (FULL_DISCOVERY_REFRESH_TOKEN_PATTERN.test(combined) || DISCOVERY_CONTEXT_CHANGE_HINT_PATTERN.test(combined));
  }

  // -------------------------------------------------------------------------
  // Public discovery API
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Internal orchestration
  // -------------------------------------------------------------------------

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
        summaries.push(this.formatStackCacheSummary(options.stackCache));
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
        specialistSummaries.push(this.formatStackCacheSummary(options.stackCache));
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
}
