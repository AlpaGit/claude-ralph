/**
 * Zod parameter schemas for all prompt templates.
 *
 * Each schema defines the required (and optional) inputs that callers
 * must provide when rendering a prompt. These are validated at render
 * time by the PromptBuilder, catching parameter mismatches early.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Discovery prompts
// ---------------------------------------------------------------------------

export const stackRefreshParamsSchema = z.object({
  normalizedPath: z.string().min(1),
  additionalContext: z.string()
});

export const discoveryStartParamsSchema = z.object({
  seedSentence: z.string().min(1),
  additionalContext: z.string(),
  projectPath: z.string(),
  hasProjectPath: z.boolean()
});

export const discoveryContinueParamsSchema = z.object({
  seedSentence: z.string().min(1),
  additionalContext: z.string(),
  projectPath: z.string(),
  formattedAnswerHistory: z.string(),
  formattedLatestAnswers: z.string()
});

export const discoveryOrchestratorParamsSchema = z.object({
  discoveryContext: z.string().min(1),
  projectPath: z.string(),
  hasProjectPath: z.boolean(),
  stackCacheSummary: z.string(),
  includeStackSpecialist: z.boolean(),
  minAgents: z.number().int().positive(),
  maxAgents: z.number().int().positive()
});

export const discoverySynthesisParamsSchema = z.object({
  discoveryContext: z.string().min(1),
  specialistSummary: z.string(),
  failedSpecialistSummary: z.string()
});

export const specialistAnalysisParamsSchema = z.object({
  jobId: z.string().min(1),
  discoveryContext: z.string().min(1),
  objective: z.string().min(1)
});

export const inferStackExistingParamsSchema = z.object({
  normalizedPath: z.string(),
  projectGoal: z.string().min(1),
  constraints: z.string(),
  currentStack: z.string()
});

export const inferStackNewParamsSchema = z.object({
  projectGoal: z.string().min(1),
  constraints: z.string(),
  currentStack: z.string()
});

// ---------------------------------------------------------------------------
// Wizard prompts
// ---------------------------------------------------------------------------

export const wizardGuidanceParamsSchema = z.object({
  stepId: z.string().min(1),
  stepTitle: z.string().min(1),
  stepGoal: z.string().min(1),
  stepCurrentData: z.string(),
  stepNote: z.string(),
  allStepsSummary: z.string(),
  draftPrompt: z.string()
});

// ---------------------------------------------------------------------------
// Planner prompts
// ---------------------------------------------------------------------------

export const createPlanParamsSchema = z.object({
  prdText: z.string().min(1),
  projectHistoryContext: z.string()
});

// ---------------------------------------------------------------------------
// Task stage prompts
// ---------------------------------------------------------------------------

export const taskImplementationParamsSchema = z.object({
  taskContext: z.string().min(1),
  retryInjection: z.string(),
  worktreeInjection: z.string()
});

export const taskArchitectureReviewParamsSchema = z.object({
  taskContext: z.string().min(1)
});

export const taskArchitectureRefactorParamsSchema = z.object({
  taskContext: z.string().min(1),
  architectureFindings: z.string().min(1),
  recommendedActions: z.string()
});

export const taskTesterParamsSchema = z.object({
  taskContext: z.string().min(1)
});

export const taskCommitterParamsSchema = z.object({
  taskContext: z.string().min(1),
  worktreeInjection: z.string()
});

export const phaseMergeParamsSchema = z.object({
  cwd: z.string().min(1),
  targetBranch: z.string().min(1),
  phaseNumber: z.number().int(),
  branchesList: z.string().min(1),
  mergeContext: z.string(),
  validationCommands: z.string()
});

export const phaseStabilizeParamsSchema = z.object({
  cwd: z.string().min(1),
  phaseNumber: z.number().int(),
  integrationBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  contextSummary: z.string(),
  validationCommands: z.string()
});

// ---------------------------------------------------------------------------
// Subagent description prompts
// ---------------------------------------------------------------------------

export const ralphWorkerImplParamsSchema = z.object({});
export const ralphWorkerRefactorParamsSchema = z.object({});
export const stackArchitectParamsSchema = z.object({});
export const prdInterviewerParamsSchema = z.object({});
