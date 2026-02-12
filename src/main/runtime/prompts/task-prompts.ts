/**
 * Task-domain prompt templates.
 *
 * Covers the multi-stage task execution pipeline (implementation,
 * architecture review, architecture refactor, tester, committer) and
 * phase-level operations (merge, stabilize).
 */

import type { PromptTemplate } from "./prompt-builder";
import {
  phaseMergeParamsSchema,
  phaseStabilizeParamsSchema,
  taskArchitectureRefactorParamsSchema,
  taskArchitectureReviewParamsSchema,
  taskCommitterParamsSchema,
  taskImplementationParamsSchema,
  taskTesterParamsSchema
} from "./prompt-schemas";

// ---------------------------------------------------------------------------
// task-implementation
// ---------------------------------------------------------------------------

export const taskImplementationTemplate: PromptTemplate<typeof taskImplementationParamsSchema> = {
  description: "Implementation stage prompt that scopes work to one task and prohibits git mutations.",
  schema: taskImplementationParamsSchema,
  render: (p) => `
You are running stage: implementation.
${p.retryInjection}
${p.worktreeInjection}
${p.taskContext}

Instructions:
1) Use the in-prompt PRD and plan progress history as authoritative context.
2) Implement only this task.
3) Keep code changes scoped and production-safe.
4) Do NOT run git commit or git merge.
5) Return concise changed-files summary.
`
};

// ---------------------------------------------------------------------------
// task-architecture-review
// ---------------------------------------------------------------------------

export const taskArchitectureReviewTemplate: PromptTemplate<typeof taskArchitectureReviewParamsSchema> = {
  description: "Architecture review stage prompt that checks task changes for structural quality.",
  schema: taskArchitectureReviewParamsSchema,
  render: (p) => `
You are running stage: architecture-review.
${p.taskContext}

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
};

// ---------------------------------------------------------------------------
// task-architecture-refactor
// ---------------------------------------------------------------------------

export const taskArchitectureRefactorTemplate: PromptTemplate<typeof taskArchitectureRefactorParamsSchema> = {
  description: "Architecture refactor stage prompt to apply targeted refactors from review findings.",
  schema: taskArchitectureRefactorParamsSchema,
  render: (p) => `
You are running stage: architecture-refactor.
${p.taskContext}

Architecture findings to fix now:
${p.architectureFindings}

Recommended actions:
${p.recommendedActions}

Instructions:
1) Apply only necessary refactors to resolve findings.
2) Preserve task scope and behavior.
3) Do NOT run git commit or git merge.
4) Return concise summary of refactors.
`
};

// ---------------------------------------------------------------------------
// task-tester
// ---------------------------------------------------------------------------

export const taskTesterTemplate: PromptTemplate<typeof taskTesterParamsSchema> = {
  description: "Tester stage prompt that prefers integration/e2e tests with unit tests as fallback.",
  schema: taskTesterParamsSchema,
  render: (p) => `
You are running stage: tester.
${p.taskContext}

Testing policy (strict):
1) Prefer integration/e2e/system tests in real runtime conditions whenever available.
2) If integration tests are not feasible, run strongest fallback and explain why.
3) Unit tests are fallback-only.
4) Provide commands run and pass/fail evidence.
5) Do NOT run git commit or git merge.
`
};

// ---------------------------------------------------------------------------
// task-committer
// ---------------------------------------------------------------------------

export const taskCommitterTemplate: PromptTemplate<typeof taskCommitterParamsSchema> = {
  description: "Committer stage prompt to create Conventional Commits after task implementation.",
  schema: taskCommitterParamsSchema,
  render: (p) => `
You are running stage: committer.
${p.taskContext}
${p.worktreeInjection}

Commit policy (strict):
1) Review current diff and ensure task scope is respected.
2) Create commit(s) using Conventional Commits:
   <type>[optional scope]: <description>
3) Allowed examples: feat, fix, docs, refactor, test, chore, perf, improvement.
4) Never include "Co-authored-by" trailer mentioning Claude.
5) Do NOT run git merge in this stage.
6) Return commit hash(es) and commit message(s).
`
};

// ---------------------------------------------------------------------------
// phase-merge
// ---------------------------------------------------------------------------

export const phaseMergeTemplate: PromptTemplate<typeof phaseMergeParamsSchema> = {
  description: "Phase merge prompt for the committer agent to merge multiple branches in order.",
  schema: phaseMergeParamsSchema,
  render: (p) => `
You are the dedicated Ralph committer agent for queue merge.

Repository root: ${p.cwd}
Target branch: ${p.targetBranch}
Phase number: ${p.phaseNumber}
Branches to merge in order:
${p.branchesList}

Merge context (task intent + execution outcomes):
${p.mergeContext}

Validation commands (must all pass before you finish):
${p.validationCommands}

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
`
};

// ---------------------------------------------------------------------------
// phase-stabilize
// ---------------------------------------------------------------------------

export const phaseStabilizeTemplate: PromptTemplate<typeof phaseStabilizeParamsSchema> = {
  description: "Phase stabilization prompt for the committer agent to stabilize integration before promotion.",
  schema: phaseStabilizeParamsSchema,
  render: (p) => `
You are the dedicated Ralph committer agent for phase integration stabilization.

Repository root: ${p.cwd}
Phase number: ${p.phaseNumber}
Integration branch: ${p.integrationBranch}
Target branch for promotion: ${p.targetBranch}

Phase context (what was intended + what already landed):
${p.contextSummary}

Validation commands:
${p.validationCommands}

Stabilization policy (strict):
1) Checkout ${p.integrationBranch}.
2) If any merge/cherry-pick/rebase conflict state exists, resolve it or cleanly abort the operation. Never leave the repository conflicted.
3) Review integration diff relative to ${p.targetBranch}; keep changes minimal and aligned with phase intent.
4) Run all validation commands. If any fail, make minimal integration fixes, commit with Conventional Commits, and rerun until all pass or truly blocked.
5) Never include any Co-authored-by trailer that mentions Claude.
6) Before finishing, ensure git status is clean and branch is ready for fast-forward promotion.
7) Provide a concise summary of fixes, validations, and resulting commit hashes.
`
};
