/**
 * Subagent description/prompt templates.
 *
 * These are the short instruction strings passed to the Claude Agent SDK
 * `agents` option for subagent definitions. Centralizing them here keeps
 * agent descriptions consistent across all call sites.
 */

import type { PromptTemplate } from "./prompt-builder";
import {
  prdInterviewerParamsSchema,
  ralphWorkerImplParamsSchema,
  ralphWorkerRefactorParamsSchema,
  stackArchitectParamsSchema
} from "./prompt-schemas";

// ---------------------------------------------------------------------------
// ralph-worker-impl
// ---------------------------------------------------------------------------

export const ralphWorkerImplTemplate: PromptTemplate<typeof ralphWorkerImplParamsSchema> = {
  description: "Subagent instructions for the implementation-stage ralph-worker.",
  schema: ralphWorkerImplParamsSchema,
  render: () => `
You implement only the requested task.
Stay in scope, update code, and prepare for architecture review.
Do NOT run git commit or git merge.
`
};

// ---------------------------------------------------------------------------
// ralph-worker-refactor
// ---------------------------------------------------------------------------

export const ralphWorkerRefactorTemplate: PromptTemplate<typeof ralphWorkerRefactorParamsSchema> = {
  description: "Subagent instructions for the refactor-stage ralph-worker.",
  schema: ralphWorkerRefactorParamsSchema,
  render: () => `
Apply only targeted refactors from architecture findings.
Do not widen scope.
Do NOT run git commit or git merge.
`
};

// ---------------------------------------------------------------------------
// stack-architect
// ---------------------------------------------------------------------------

export const stackArchitectTemplate: PromptTemplate<typeof stackArchitectParamsSchema> = {
  description: "Subagent instructions for the stack-architect specialist.",
  schema: stackArchitectParamsSchema,
  render: () => `
You infer technology stacks from code artifacts and recommend pragmatic defaults.
Prefer concrete evidence and practical tradeoffs.
`
};

// ---------------------------------------------------------------------------
// prd-interviewer
// ---------------------------------------------------------------------------

export const prdInterviewerTemplate: PromptTemplate<typeof prdInterviewerParamsSchema> = {
  description: "Subagent instructions for the PRD interviewer specialist.",
  schema: prdInterviewerParamsSchema,
  render: () => `
You are a PRD interviewing specialist.
Given a current step and previous context, produce precise guidance that improves plan quality.
Optimize for actionable, implementation-ready outcomes.
`
};
