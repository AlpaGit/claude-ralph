/**
 * TaskAgent — standalone class encapsulating the multi-stage task execution
 * pipeline and phase-level committer operations.
 *
 * Extracted from RalphAgentService to satisfy the god-class decomposition
 * target in Track 1 of the v0.2.0 PRD.
 *
 * Responsibilities:
 * - runTask: multi-stage pipeline (implementation → architecture-review → refactor → tester → committer)
 * - executeStage: reusable private stage runner with tool policy, logging, and subagent tracking
 * - mergePhaseWithCommitter: phase-level branch merge via committer agent
 * - stabilizePhaseIntegrationWithCommitter: phase integration stabilization via committer agent
 *
 * Dependencies are injected via constructor:
 * - `ModelResolver` function to resolve agent-role → model-id
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRole, RalphPlan, RalphTask, TodoItem } from "@shared/types";
import {
  baseOptions,
  GIT_MERGE_COMMAND_PATTERN,
  MAX_ARCH_REFACTOR_CYCLES,
  MUTATING_GIT_COMMAND_PATTERN,
  type ModelResolver
} from "./agent-constants";
import {
  architectureReviewJsonSchema,
  architectureReviewSchema,
  type ArchitectureReview
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
  validateCommitPolicyForRange
} from "./agent-utils";

// ---------------------------------------------------------------------------
// Re-export for backward compatibility
// ---------------------------------------------------------------------------

export type { ModelResolver } from "./agent-constants";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunTaskCallbacks {
  onLog: (line: string) => void;
  onTodo: (todos: TodoItem[]) => void;
  onSession: (sessionId: string) => void;
  onSubagent: (payload: unknown) => void;
  onQuery: (queryHandle: { interrupt: () => Promise<void> }) => void;
}

export interface RetryContext {
  retryCount: number;
  previousError: string;
}

export interface RunTaskArgs {
  plan: RalphPlan;
  task: RalphTask;
  planProgressContext?: string;
  callbacks: RunTaskCallbacks;
  retryContext?: RetryContext;
  workingDirectory?: string;
  branchName?: string;
  phaseNumber?: number;
}

export interface RunTaskResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
}

export interface CommitterCallbacks {
  onLog: (line: string) => void;
  onQuery: (queryHandle: { interrupt: () => Promise<void> }) => void;
}

export interface MergePhaseArgs {
  repoRoot: string;
  targetBranch: string;
  branches: string[];
  phaseNumber: number;
  mergeContextSummary?: string;
  validationCommands?: string[];
  callbacks: CommitterCallbacks;
}

export interface MergePhaseResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
}

export interface StabilizePhaseIntegrationArgs {
  repoRoot: string;
  targetBranch: string;
  integrationBranch: string;
  phaseNumber: number;
  phaseContextSummary?: string;
  validationCommands: string[];
  callbacks: CommitterCallbacks;
}

export interface StabilizePhaseIntegrationResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RunStageInput {
  stageName: string;
  prompt: string;
  model: string;
  maxTurns: number;
  outputSchema?: Record<string, unknown>;
  agents?: NonNullable<Options["agents"]>;
}

interface RunStageResult {
  resultText: string;
  stopReason: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  structuredOutput?: unknown;
}

interface CommitterStreamResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
}

// ---------------------------------------------------------------------------
// TaskAgent
// ---------------------------------------------------------------------------

export class TaskAgent {
  private readonly getModel: ModelResolver;

  constructor(getModel: ModelResolver) {
    this.getModel = getModel;
  }

  // -------------------------------------------------------------------------
  // Task execution pipeline
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

    const consumeStageResult = (result: RunStageResult, stageName: string): void => {
      // Update the shared session id for stage chaining
      // (executeStage updates sessionIdRef.current internally)
      totalDurationMs += result.durationMs ?? 0;
      if (result.totalCostUsd !== null) {
        totalCostUsd += result.totalCostUsd;
        hasCost = true;
      }
      if (result.resultText.trim().length > 0) {
        finalSections.push(`## ${stageName}\n${result.resultText.trim()}`);
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

    // Mutable ref so executeStage can propagate session id changes across stages
    const sessionIdRef = { current: runSessionId };

    // Stage runner that updates the shared sessionIdRef after each stage
    const runStageTracked = async (input: RunStageInput): Promise<RunStageResult> => {
      const result = await this.executeStage(input, {
        cwd,
        callbacks: args.callbacks,
        sessionIdRef,
        clearSessionId
      });
      runSessionId = sessionIdRef.current;
      return result;
    };

    const implResult = await runStageTracked({
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
    consumeStageResult(implResult, "implementation");
    await ensureNoCommitYet("implementation");

    let architectureReviewIteration = 0;
    let lastArchitectureReview: ArchitectureReview | null = null;

    while (true) {
      architectureReviewIteration += 1;

      const reviewResult = await runStageTracked({
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

      const refactorResult = await runStageTracked({
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
      consumeStageResult(refactorResult, `architecture-refactor-${architectureReviewIteration}`);
      await ensureNoCommitYet(`architecture-refactor-${architectureReviewIteration}`);
    }

    await ensureNoCommitYet("architecture-gate-complete");

    const testerResult = await runStageTracked({
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
    consumeStageResult(testerResult, "tester");
    await ensureNoCommitYet("tester");

    const headBeforeCommitter = await readGitHeadCommit(cwd);
    if (!headBeforeCommitter) {
      throw new Error("Unable to determine HEAD before committer stage.");
    }

    const committerResult = await runStageTracked({
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
    consumeStageResult(committerResult, "committer");

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
      sessionId: sessionIdRef.current,
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

    const clearSessionId = await this.startClearedSession(committerModel, cwd);

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

    return this.processCommitterStream(mergeResponse, clearSessionId, args.callbacks.onLog);
  }

  // -------------------------------------------------------------------------
  // Phase stabilization
  // -------------------------------------------------------------------------

  async stabilizePhaseIntegrationWithCommitter(
    args: StabilizePhaseIntegrationArgs
  ): Promise<StabilizePhaseIntegrationResult> {
    const cwd = resolveQueryCwd(args.repoRoot);
    const committerModel = this.getModel("committer");

    const clearSessionId = await this.startClearedSession(committerModel, cwd);

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

    return this.processCommitterStream(stabilizeResponse, clearSessionId, args.callbacks.onLog);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Start a fresh `/clear` session and return the session ID.
   * Used by both mergePhaseWithCommitter and stabilizePhaseIntegrationWithCommitter
   * to eliminate the duplicate session-clearing boilerplate.
   */
  private async startClearedSession(model: string, cwd: string): Promise<string> {
    const clearResponse = query({
      prompt: "/clear",
      options: {
        ...baseOptions,
        model,
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
      throw new Error("Unable to start a cleared committer session.");
    }

    return clearSessionId;
  }

  /**
   * Process a committer-style query stream, extracting session ID, result text,
   * and stop reason. Shared by mergePhaseWithCommitter and
   * stabilizePhaseIntegrationWithCommitter to eliminate duplicate for-await loops.
   */
  private async processCommitterStream(
    response: AsyncIterable<unknown>,
    initialSessionId: string | null,
    onLog: (line: string) => void
  ): Promise<CommitterStreamResult> {
    let sessionId: string | null = initialSessionId;
    let resultText = "";
    let stopReason: string | null = null;

    for await (const message of response) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        onLog(textChunk);
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

    return { sessionId, resultText, stopReason };
  }

  /**
   * Execute a single agent stage within the task pipeline.
   *
   * Receives shared mutable state via the `context` parameter so that
   * session ID changes propagate across chained stages.
   */
  private async executeStage(
    input: RunStageInput,
    context: {
      cwd: string;
      callbacks: RunTaskCallbacks;
      sessionIdRef: { current: string | null };
      clearSessionId: string | null;
    }
  ): Promise<RunStageResult> {
    const agentRole = mapStageToAgentRole(input.stageName);
    context.callbacks.onLog(`\n[stage] ${input.stageName} started\n`);
    context.callbacks.onSubagent({
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
        cwd: context.cwd,
        resume: context.sessionIdRef.current ?? context.clearSessionId ?? undefined,
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

      context.callbacks.onQuery(response);

      let resultText = "";
      let stopReason: string | null = null;
      let stageDurationMs: number | null = null;
      let stageCostUsd: number | null = null;
      let structuredOutput: unknown;

      for await (const message of response) {
        const textChunk = extractTextDelta(message);
        if (textChunk) {
          context.callbacks.onLog(textChunk);
        }

        const initMessage = message as { type?: string; subtype?: string; session_id?: string };
        if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
          context.sessionIdRef.current = initMessage.session_id;
          context.callbacks.onSession(initMessage.session_id);
        }

        const blocks = extractAssistantToolBlocks(message);
        for (const block of blocks) {
          if (block.type !== "tool_use" || !block.name) {
            continue;
          }

          if (block.name === "TodoWrite") {
            const toolInput = block.input as { todos?: TodoItem[] } | undefined;
            if (Array.isArray(toolInput?.todos)) {
              context.callbacks.onTodo(toolInput.todos);
            }
          }

          if (block.name === "Task") {
            const invocation = parseTaskToolInvocation(block.input);
            if (invocation) {
              context.callbacks.onLog(
                `\n[subagent-spawn] stage=${input.stageName} subagent=${invocation.subagentType} description=${JSON.stringify(invocation.description)}\n`
              );
              context.callbacks.onLog(`[subagent-spawn-prompt] ${JSON.stringify(invocation.prompt)}\n`);
            }

            context.callbacks.onSubagent({
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

      context.callbacks.onLog(`\n[stage] ${input.stageName} completed\n`);
      context.callbacks.onSubagent({
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
      context.callbacks.onSubagent({
        kind: "agent_stage",
        stage: input.stageName,
        agentRole,
        status: "failed",
        summary: message.slice(0, 400)
      });
      throw error;
    }
  }
}
