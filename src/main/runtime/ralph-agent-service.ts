import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentRole,
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
  GIT_MERGE_COMMAND_PATTERN,
  MAX_ARCH_REFACTOR_CYCLES,
  MUTATING_GIT_COMMAND_PATTERN
} from "./agent-constants";
import {
  architectureReviewJsonSchema,
  architectureReviewSchema,
  type ArchitectureReview,
  wizardGuidanceJsonSchema,
  wizardGuidanceSchema
} from "./agent-schemas";
import {
  enforceArchitectureQualityGate,
  extractAssistantToolBlocks,
  extractBashCommand,
  extractTextDelta,
  mapStageToAgentRole,
  parseTaskToolInvocation,
  readGitHeadCommit,
  resolveQueryCwd,
  summarizeArchitectureFindings,
  tryParseStructuredOutputFromText,
  validateCommitPolicyForRange
} from "./agent-utils";
import {
  DiscoveryAgent,
  type DiscoveryCallbacks,
  type DiscoveryOutput,
  type StackProfileCache,
  type StackProfileStore,
  type StartDiscoveryArgs,
  type ContinueDiscoveryArgs
} from "./discovery-agent";

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------

export type { StackProfileCache, StackProfileStore } from "./discovery-agent";
export { DiscoveryAgent } from "./discovery-agent";

/** Map of agent role to model ID, loaded from model_config DB table. */
export type ModelConfigMap = Map<AgentRole, string>;

// ---------------------------------------------------------------------------
// Local interfaces (non-discovery)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// RalphAgentService
// ---------------------------------------------------------------------------

export class RalphAgentService {
  private readonly modelConfig: ModelConfigMap;
  private readonly discovery: DiscoveryAgent;

  constructor(modelConfig?: ModelConfigMap, stackProfileStore?: StackProfileStore) {
    this.modelConfig = modelConfig ?? new Map();
    this.discovery = new DiscoveryAgent(this.getModel.bind(this), stackProfileStore);
  }

  /**
   * Resolve the model ID for a given agent role.
   * Falls back to opinionated defaults when no DB config exists.
   */
  private getModel(role: AgentRole): string {
    return this.modelConfig.get(role) ?? DEFAULT_MODEL_BY_ROLE[role];
  }

  // -------------------------------------------------------------------------
  // Discovery delegation
  // -------------------------------------------------------------------------

  async refreshStackProfile(args: {
    projectPath: string;
    additionalContext?: string;
    callbacks?: DiscoveryCallbacks;
  }): Promise<StackProfileCache> {
    return this.discovery.refreshStackProfile(args);
  }

  async startDiscovery(args: StartDiscoveryArgs): Promise<DiscoveryOutput> {
    return this.discovery.startDiscovery(args);
  }

  async continueDiscovery(args: ContinueDiscoveryArgs): Promise<DiscoveryOutput> {
    return this.discovery.continueDiscovery(args);
  }

  async inferStack(input: InferStackInput): Promise<InferStackResult> {
    return this.discovery.inferStack(input);
  }

  // -------------------------------------------------------------------------
  // Wizard guidance
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Plan creation
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------

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
- pass_with_notes: non-critical findings are present and still require targeted code changes before continuation.
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

      if (review.status === "pass") {
        break;
      }

      if (review.status === "pass_with_notes") {
        args.callbacks.onLog(
          "\n[policy] pass_with_notes is treated as changes required. Continuing with architecture refactor.\n"
        );
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

  // -------------------------------------------------------------------------
  // Phase merge
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Phase stabilization
  // -------------------------------------------------------------------------

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
