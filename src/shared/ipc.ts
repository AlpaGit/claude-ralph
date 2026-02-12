import { z } from "zod";

export const IPC_CHANNELS = {
  createPlan: "plan:create",
  getPlan: "plan:get",
  runTask: "task:run",
  runAll: "task:runAll",
  cancelRun: "run:cancel",
  startDiscovery: "discovery:start",
  continueDiscovery: "discovery:continue",
  discoveryEvent: "discovery:event",
  wizardGuidance: "wizard:guidance",
  inferStack: "wizard:inferStack",
  runEvent: "run:event"
} as const;

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
    .min(1, "At least one answer is required.")
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
