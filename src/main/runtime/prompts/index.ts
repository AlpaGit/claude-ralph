/**
 * Prompt registry barrel — single source of truth for all Ralph prompt templates.
 *
 * Exports a pre-populated `prompts` singleton and the `PROMPT_NAMES` enum
 * for type-safe template references.
 *
 * Usage:
 * ```ts
 * import { prompts, PROMPT_NAMES } from "./prompts";
 * const text = prompts.render(PROMPT_NAMES.DISCOVERY_START, { seedSentence, ... });
 * ```
 */

import { PromptBuilder } from "./prompt-builder";
import {
  discoveryContinueTemplate,
  discoveryOrchestratorTemplate,
  discoveryStartTemplate,
  discoverySynthesisTemplate,
  inferStackExistingTemplate,
  inferStackNewTemplate,
  specialistAnalysisTemplate,
  stackRefreshTemplate
} from "./discovery-prompts";
import { wizardGuidanceTemplate } from "./wizard-prompts";
import { createPlanTemplate } from "./planner-prompts";
import {
  phaseMergeTemplate,
  phaseStabilizeTemplate,
  taskArchitectureRefactorTemplate,
  taskArchitectureReviewTemplate,
  taskCommitterTemplate,
  taskImplementationTemplate,
  taskTesterTemplate
} from "./task-prompts";
import {
  prdInterviewerTemplate,
  ralphWorkerImplTemplate,
  ralphWorkerRefactorTemplate,
  stackArchitectTemplate
} from "./subagent-prompts";

// ---------------------------------------------------------------------------
// Canonical prompt name constants
// ---------------------------------------------------------------------------

/**
 * String-literal constants for every registered prompt name.
 * Use these instead of raw strings to prevent typos and enable rename refactors.
 */
export const PROMPT_NAMES = {
  // Discovery
  STACK_REFRESH: "stack-refresh",
  DISCOVERY_START: "discovery-start",
  DISCOVERY_CONTINUE: "discovery-continue",
  DISCOVERY_ORCHESTRATOR: "discovery-orchestrator",
  DISCOVERY_SYNTHESIS: "discovery-synthesis",
  SPECIALIST_ANALYSIS: "specialist-analysis",
  INFER_STACK_EXISTING: "infer-stack-existing",
  INFER_STACK_NEW: "infer-stack-new",

  // Wizard
  WIZARD_GUIDANCE: "wizard-guidance",

  // Planner
  CREATE_PLAN: "create-plan",

  // Task stages
  TASK_IMPLEMENTATION: "task-implementation",
  TASK_ARCHITECTURE_REVIEW: "task-architecture-review",
  TASK_ARCHITECTURE_REFACTOR: "task-architecture-refactor",
  TASK_TESTER: "task-tester",
  TASK_COMMITTER: "task-committer",

  // Phase operations
  PHASE_MERGE: "phase-merge",
  PHASE_STABILIZE: "phase-stabilize",

  // Subagent descriptions
  SUBAGENT_RALPH_WORKER_IMPL: "subagent-ralph-worker-impl",
  SUBAGENT_RALPH_WORKER_REFACTOR: "subagent-ralph-worker-refactor",
  SUBAGENT_STACK_ARCHITECT: "subagent-stack-architect",
  SUBAGENT_PRD_INTERVIEWER: "subagent-prd-interviewer"
} as const;

export type PromptName = (typeof PROMPT_NAMES)[keyof typeof PROMPT_NAMES];

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

const builder = new PromptBuilder();

// Discovery
builder.register(PROMPT_NAMES.STACK_REFRESH, stackRefreshTemplate);
builder.register(PROMPT_NAMES.DISCOVERY_START, discoveryStartTemplate);
builder.register(PROMPT_NAMES.DISCOVERY_CONTINUE, discoveryContinueTemplate);
builder.register(PROMPT_NAMES.DISCOVERY_ORCHESTRATOR, discoveryOrchestratorTemplate);
builder.register(PROMPT_NAMES.DISCOVERY_SYNTHESIS, discoverySynthesisTemplate);
builder.register(PROMPT_NAMES.SPECIALIST_ANALYSIS, specialistAnalysisTemplate);
builder.register(PROMPT_NAMES.INFER_STACK_EXISTING, inferStackExistingTemplate);
builder.register(PROMPT_NAMES.INFER_STACK_NEW, inferStackNewTemplate);

// Wizard
builder.register(PROMPT_NAMES.WIZARD_GUIDANCE, wizardGuidanceTemplate);

// Planner
builder.register(PROMPT_NAMES.CREATE_PLAN, createPlanTemplate);

// Task stages
builder.register(PROMPT_NAMES.TASK_IMPLEMENTATION, taskImplementationTemplate);
builder.register(PROMPT_NAMES.TASK_ARCHITECTURE_REVIEW, taskArchitectureReviewTemplate);
builder.register(PROMPT_NAMES.TASK_ARCHITECTURE_REFACTOR, taskArchitectureRefactorTemplate);
builder.register(PROMPT_NAMES.TASK_TESTER, taskTesterTemplate);
builder.register(PROMPT_NAMES.TASK_COMMITTER, taskCommitterTemplate);

// Phase operations
builder.register(PROMPT_NAMES.PHASE_MERGE, phaseMergeTemplate);
builder.register(PROMPT_NAMES.PHASE_STABILIZE, phaseStabilizeTemplate);

// Subagent descriptions
builder.register(PROMPT_NAMES.SUBAGENT_RALPH_WORKER_IMPL, ralphWorkerImplTemplate);
builder.register(PROMPT_NAMES.SUBAGENT_RALPH_WORKER_REFACTOR, ralphWorkerRefactorTemplate);
builder.register(PROMPT_NAMES.SUBAGENT_STACK_ARCHITECT, stackArchitectTemplate);
builder.register(PROMPT_NAMES.SUBAGENT_PRD_INTERVIEWER, prdInterviewerTemplate);

/**
 * Pre-populated prompt registry singleton.
 * All 21 templates are registered at module load time.
 */
export const prompts = builder;

// Re-export core types for external usage
export { PromptBuilder, type PromptTemplate } from "./prompt-builder";
