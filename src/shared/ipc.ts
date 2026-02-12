import { z } from "zod";

export const IPC_CHANNELS = {
  createPlan: "plan:create",
  getPlan: "plan:get",
  listPlans: "plan:list",
  listProjectMemory: "project-memory:list",
  refreshProjectStackProfile: "project-memory:refresh",
  deletePlan: "plan:delete",
  archivePlan: "plan:archive",
  unarchivePlan: "plan:unarchive",
  runTask: "task:run",
  runAll: "task:runAll",
  cancelRun: "run:cancel",
  retryTask: "task:retry",
  skipTask: "task:skip",
  approveTaskProposal: "proposal:approve",
  dismissTaskProposal: "proposal:dismiss",
  abortQueue: "queue:abort",
  startDiscovery: "discovery:start",
  continueDiscovery: "discovery:continue",
  discoveryEvent: "discovery:event",
  wizardGuidance: "wizard:guidance",
  inferStack: "wizard:inferStack",
  runEvent: "run:event",
  getModelConfig: "config:getModels",
  updateModelConfig: "config:updateModel",
  getAppSettings: "config:getAppSettings",
  updateAppSettings: "config:updateAppSettings",
  discoverySessions: "discovery:sessions",
  discoveryResume: "discovery:resume",
  discoveryAbandon: "discovery:abandon",
  discoveryCancel: "discovery:cancel",
  getRunEvents: "run:getEvents"
} as const;

export const listPlansInputSchema = z.object({
  filter: z.object({
    archived: z.boolean().optional(),
    search: z.string().optional()
  }).optional()
});

export const listProjectMemoryInputSchema = z.object({
  search: z.string().optional(),
  limitPlans: z.number().int().min(1).max(20).optional()
}).default({});

export const refreshProjectStackProfileInputSchema = z.object({
  projectId: z.string().min(1)
});

export const deletePlanInputSchema = z.object({
  planId: z.string().uuid()
});

export const archivePlanInputSchema = z.object({
  planId: z.string().uuid()
});

export const unarchivePlanInputSchema = z.object({
  planId: z.string().uuid()
});

export const createPlanInputSchema = z.object({
  prdText: z.string().min(20, "PRD text must be at least 20 characters."),
  projectPath: z.string()
});

export const getPlanInputSchema = z.object({
  planId: z.string().uuid()
});

export const runTaskInputSchema = z.object({
  planId: z.string().uuid(),
  taskId: z.string().min(1)
});

export const runAllInputSchema = z.object({
  planId: z.string().uuid()
});

export const cancelRunInputSchema = z.object({
  runId: z.string().uuid()
});

export const retryTaskInputSchema = z.object({
  planId: z.string().uuid(),
  taskId: z.string().min(1)
});

export const skipTaskInputSchema = z.object({
  planId: z.string().uuid(),
  taskId: z.string().min(1)
});

export const approveTaskProposalInputSchema = z.object({
  planId: z.string().uuid(),
  proposalId: z.string().uuid()
});

export const dismissTaskProposalInputSchema = z.object({
  planId: z.string().uuid(),
  proposalId: z.string().uuid()
});

export const abortQueueInputSchema = z.object({
  planId: z.string().uuid()
});

export const startDiscoveryInputSchema = z.object({
  projectPath: z.string(),
  seedSentence: z.string().min(5, "Seed sentence must be at least 5 characters."),
  additionalContext: z.string()
});

export const continueDiscoveryInputSchema = z.object({
  sessionId: z.string().uuid(),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        answer: z.string().min(1)
      })
    )
    .min(0)
});

export const wizardStepDataSchema = z.object({
  stepId: z.enum(["context", "goals", "constraints", "priorities", "success", "review"]),
  title: z.string().min(1),
  goal: z.string().min(1),
  currentData: z.string().min(1),
  note: z.string()
});

export const getWizardGuidanceInputSchema = z.object({
  projectPath: z.string(),
  draftPrompt: z.string().min(1),
  step: wizardStepDataSchema,
  allSteps: z.array(wizardStepDataSchema).min(1)
});

export const inferStackInputSchema = z.object({
  projectMode: z.enum(["existing", "new"]),
  projectPath: z.string(),
  projectGoal: z.string().min(1),
  constraints: z.string(),
  currentStack: z.string()
});

export const updateModelConfigInputSchema = z.object({
  agentRole: z.enum([
    "discovery_specialist",
    "plan_synthesis",
    "task_execution",
    "tester",
    "architecture_specialist",
    "committer"
  ]),
  modelId: z.string().min(1)
});

export const updateAppSettingsInputSchema = z.object({
  discordWebhookUrl: z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => value.length === 0 || /^https?:\/\//i.test(value),
      "discordWebhookUrl must be empty or a valid URL."
    )
});

export const discoveryResumeInputSchema = z.object({
  sessionId: z.string().uuid()
});

export const discoveryAbandonInputSchema = z.object({
  sessionId: z.string().uuid()
});

export const discoveryCancelInputSchema = z.object({
  sessionId: z.string().uuid()
});

export const getRunEventsInputSchema = z.object({
  runId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).optional(),
  afterId: z.string().optional()
});
