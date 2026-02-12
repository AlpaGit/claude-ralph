/**
 * Comprehensive unit tests for all Zod schemas defined in @shared/ipc.ts.
 *
 * For each schema: tests valid input passes, missing required fields fail,
 * invalid types fail, and boundary values (min length, UUID format).
 *
 * Uses z.safeParse() to check success/error branches without throwing.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

import {
  listPlansInputSchema,
  deletePlanInputSchema,
  archivePlanInputSchema,
  unarchivePlanInputSchema,
  createPlanInputSchema,
  getPlanInputSchema,
  runTaskInputSchema,
  runAllInputSchema,
  cancelRunInputSchema,
  retryTaskInputSchema,
  skipTaskInputSchema,
  abortQueueInputSchema,
  startDiscoveryInputSchema,
  continueDiscoveryInputSchema,
  wizardStepDataSchema,
  getWizardGuidanceInputSchema,
  inferStackInputSchema,
  updateModelConfigInputSchema,
  discoveryResumeInputSchema,
  discoveryAbandonInputSchema,
  discoveryCancelInputSchema
} from "@shared/ipc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = randomUUID();
const VALID_UUID_2 = randomUUID();
const INVALID_UUID = "not-a-uuid";
const INVALID_UUID_PARTIAL = "12345678-1234-1234-1234";

// ---------------------------------------------------------------------------
// createPlanInputSchema
// ---------------------------------------------------------------------------

describe("createPlanInputSchema", () => {
  it("accepts valid full input", () => {
    const result = createPlanInputSchema.safeParse({
      prdText: "This is a valid PRD text that is at least 20 characters long.",
      projectPath: "/some/project/path"
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prdText).toBe(
        "This is a valid PRD text that is at least 20 characters long."
      );
      expect(result.data.projectPath).toBe("/some/project/path");
    }
  });

  it("rejects missing prdText", () => {
    const result = createPlanInputSchema.safeParse({
      projectPath: "/some/path"
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing projectPath", () => {
    const result = createPlanInputSchema.safeParse({
      prdText: "This is a valid PRD text that is at least 20 characters long."
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty projectPath (wrong type)", () => {
    // projectPath is z.string() with no min constraint, but must be string
    const result = createPlanInputSchema.safeParse({
      prdText: "This is a valid PRD text that is at least 20 characters long.",
      projectPath: 123
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty projectPath string", () => {
    // projectPath is z.string() with no min constraint
    const result = createPlanInputSchema.safeParse({
      prdText: "This is a valid PRD text that is at least 20 characters long.",
      projectPath: ""
    });
    expect(result.success).toBe(true);
  });

  it("rejects prdText shorter than 20 characters", () => {
    const result = createPlanInputSchema.safeParse({
      prdText: "Too short",
      projectPath: "/path"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const prdIssue = result.error.issues.find((i) =>
        i.path.includes("prdText")
      );
      expect(prdIssue).toBeDefined();
      expect(prdIssue!.message).toContain("20");
    }
  });

  it("accepts prdText at exactly 20 characters", () => {
    const result = createPlanInputSchema.safeParse({
      prdText: "12345678901234567890", // exactly 20 chars
      projectPath: "/path"
    });
    expect(result.success).toBe(true);
  });

  it("rejects prdText at 19 characters (boundary)", () => {
    const result = createPlanInputSchema.safeParse({
      prdText: "1234567890123456789", // 19 chars
      projectPath: "/path"
    });
    expect(result.success).toBe(false);
  });

  it("rejects prdText of wrong type (number)", () => {
    const result = createPlanInputSchema.safeParse({
      prdText: 42,
      projectPath: "/path"
    });
    expect(result.success).toBe(false);
  });

  it("rejects null input", () => {
    const result = createPlanInputSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it("rejects undefined input", () => {
    const result = createPlanInputSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPlanInputSchema
// ---------------------------------------------------------------------------

describe("getPlanInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = getPlanInputSchema.safeParse({ planId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = getPlanInputSchema.safeParse({ planId: INVALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects partial UUID", () => {
    const result = getPlanInputSchema.safeParse({
      planId: INVALID_UUID_PARTIAL
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing planId", () => {
    const result = getPlanInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects number planId", () => {
    const result = getPlanInputSchema.safeParse({ planId: 123 });
    expect(result.success).toBe(false);
  });

  it("rejects empty string planId", () => {
    const result = getPlanInputSchema.safeParse({ planId: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listPlansInputSchema
// ---------------------------------------------------------------------------

describe("listPlansInputSchema", () => {
  it("accepts empty object (no filter)", () => {
    const result = listPlansInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts filter with archived boolean", () => {
    const result = listPlansInputSchema.safeParse({
      filter: { archived: true }
    });
    expect(result.success).toBe(true);
  });

  it("accepts filter with search string", () => {
    const result = listPlansInputSchema.safeParse({
      filter: { search: "my plan" }
    });
    expect(result.success).toBe(true);
  });

  it("accepts filter with both archived and search", () => {
    const result = listPlansInputSchema.safeParse({
      filter: { archived: false, search: "test" }
    });
    expect(result.success).toBe(true);
  });

  it("accepts undefined filter", () => {
    const result = listPlansInputSchema.safeParse({ filter: undefined });
    expect(result.success).toBe(true);
  });

  it("rejects filter with invalid archived type", () => {
    const result = listPlansInputSchema.safeParse({
      filter: { archived: "yes" }
    });
    expect(result.success).toBe(false);
  });

  it("rejects filter with invalid search type", () => {
    const result = listPlansInputSchema.safeParse({
      filter: { search: 42 }
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deletePlanInputSchema
// ---------------------------------------------------------------------------

describe("deletePlanInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = deletePlanInputSchema.safeParse({ planId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = deletePlanInputSchema.safeParse({ planId: INVALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects missing planId", () => {
    const result = deletePlanInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// archivePlanInputSchema
// ---------------------------------------------------------------------------

describe("archivePlanInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = archivePlanInputSchema.safeParse({ planId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = archivePlanInputSchema.safeParse({ planId: INVALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects missing planId", () => {
    const result = archivePlanInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unarchivePlanInputSchema
// ---------------------------------------------------------------------------

describe("unarchivePlanInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = unarchivePlanInputSchema.safeParse({ planId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = unarchivePlanInputSchema.safeParse({ planId: INVALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects missing planId", () => {
    const result = unarchivePlanInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runTaskInputSchema
// ---------------------------------------------------------------------------

describe("runTaskInputSchema", () => {
  it("accepts valid UUIDs for planId and min-1 taskId", () => {
    const result = runTaskInputSchema.safeParse({
      planId: VALID_UUID,
      taskId: "task-001"
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID planId", () => {
    const result = runTaskInputSchema.safeParse({
      planId: INVALID_UUID,
      taskId: "task-001"
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty taskId", () => {
    const result = runTaskInputSchema.safeParse({
      planId: VALID_UUID,
      taskId: ""
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing planId", () => {
    const result = runTaskInputSchema.safeParse({ taskId: "task-001" });
    expect(result.success).toBe(false);
  });

  it("rejects missing taskId", () => {
    const result = runTaskInputSchema.safeParse({ planId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects number taskId", () => {
    const result = runTaskInputSchema.safeParse({
      planId: VALID_UUID,
      taskId: 42
    });
    expect(result.success).toBe(false);
  });

  it("accepts UUID-format taskId", () => {
    const result = runTaskInputSchema.safeParse({
      planId: VALID_UUID,
      taskId: VALID_UUID_2
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runAllInputSchema
// ---------------------------------------------------------------------------

describe("runAllInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = runAllInputSchema.safeParse({ planId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = runAllInputSchema.safeParse({ planId: INVALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects missing planId", () => {
    const result = runAllInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cancelRunInputSchema
// ---------------------------------------------------------------------------

describe("cancelRunInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = cancelRunInputSchema.safeParse({ runId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = cancelRunInputSchema.safeParse({ runId: INVALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects missing runId", () => {
    const result = cancelRunInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty string runId", () => {
    const result = cancelRunInputSchema.safeParse({ runId: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// retryTaskInputSchema
// ---------------------------------------------------------------------------

describe("retryTaskInputSchema", () => {
  it("accepts valid input", () => {
    const result = retryTaskInputSchema.safeParse({
      planId: VALID_UUID,
      taskId: "task-001"
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID planId", () => {
    const result = retryTaskInputSchema.safeParse({
      planId: INVALID_UUID,
      taskId: "task-001"
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty taskId", () => {
    const result = retryTaskInputSchema.safeParse({
      planId: VALID_UUID,
      taskId: ""
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing both fields", () => {
    const result = retryTaskInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// skipTaskInputSchema
// ---------------------------------------------------------------------------

describe("skipTaskInputSchema", () => {
  it("accepts valid input", () => {
    const result = skipTaskInputSchema.safeParse({
      planId: VALID_UUID,
      taskId: "task-001"
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID planId", () => {
    const result = skipTaskInputSchema.safeParse({
      planId: INVALID_UUID,
      taskId: "task-001"
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty taskId", () => {
    const result = skipTaskInputSchema.safeParse({
      planId: VALID_UUID,
      taskId: ""
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// abortQueueInputSchema
// ---------------------------------------------------------------------------

describe("abortQueueInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = abortQueueInputSchema.safeParse({ planId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = abortQueueInputSchema.safeParse({ planId: INVALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects missing planId", () => {
    const result = abortQueueInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startDiscoveryInputSchema
// ---------------------------------------------------------------------------

describe("startDiscoveryInputSchema", () => {
  it("accepts valid full input", () => {
    const result = startDiscoveryInputSchema.safeParse({
      projectPath: "/my/project",
      seedSentence: "Build an e-commerce platform",
      additionalContext: "Uses React and Node"
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing projectPath", () => {
    const result = startDiscoveryInputSchema.safeParse({
      seedSentence: "Build an e-commerce platform",
      additionalContext: "Uses React"
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing seedSentence", () => {
    const result = startDiscoveryInputSchema.safeParse({
      projectPath: "/my/project",
      additionalContext: "Uses React"
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing additionalContext", () => {
    const result = startDiscoveryInputSchema.safeParse({
      projectPath: "/my/project",
      seedSentence: "Build an e-commerce platform"
    });
    expect(result.success).toBe(false);
  });

  it("rejects seedSentence shorter than 5 characters", () => {
    const result = startDiscoveryInputSchema.safeParse({
      projectPath: "/my/project",
      seedSentence: "abcd",
      additionalContext: ""
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const seedIssue = result.error.issues.find((i) =>
        i.path.includes("seedSentence")
      );
      expect(seedIssue).toBeDefined();
      expect(seedIssue!.message).toContain("5");
    }
  });

  it("accepts seedSentence at exactly 5 characters", () => {
    const result = startDiscoveryInputSchema.safeParse({
      projectPath: "/my/project",
      seedSentence: "abcde",
      additionalContext: ""
    });
    expect(result.success).toBe(true);
  });

  it("rejects seedSentence at 4 characters (boundary)", () => {
    const result = startDiscoveryInputSchema.safeParse({
      projectPath: "/my/project",
      seedSentence: "abcd",
      additionalContext: ""
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty additionalContext", () => {
    const result = startDiscoveryInputSchema.safeParse({
      projectPath: "/my/project",
      seedSentence: "Build something",
      additionalContext: ""
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty projectPath", () => {
    const result = startDiscoveryInputSchema.safeParse({
      projectPath: "",
      seedSentence: "Build something",
      additionalContext: ""
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// continueDiscoveryInputSchema
// ---------------------------------------------------------------------------

describe("continueDiscoveryInputSchema", () => {
  it("accepts valid input with one answer", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: VALID_UUID,
      answers: [{ questionId: "q1", answer: "My answer" }]
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with multiple answers", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: VALID_UUID,
      answers: [
        { questionId: "q1", answer: "Answer 1" },
        { questionId: "q2", answer: "Answer 2" },
        { questionId: "q3", answer: "Answer 3" }
      ]
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID sessionId", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: INVALID_UUID,
      answers: [{ questionId: "q1", answer: "My answer" }]
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty answers array", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: VALID_UUID,
      answers: []
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const answersIssue = result.error.issues.find((i) =>
        i.path.includes("answers")
      );
      expect(answersIssue).toBeDefined();
    }
  });

  it("rejects answer with empty questionId", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: VALID_UUID,
      answers: [{ questionId: "", answer: "My answer" }]
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer with empty answer string", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: VALID_UUID,
      answers: [{ questionId: "q1", answer: "" }]
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing sessionId", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      answers: [{ questionId: "q1", answer: "My answer" }]
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing answers", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: VALID_UUID
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer missing questionId field", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: VALID_UUID,
      answers: [{ answer: "My answer" }]
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer missing answer field", () => {
    const result = continueDiscoveryInputSchema.safeParse({
      sessionId: VALID_UUID,
      answers: [{ questionId: "q1" }]
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// wizardStepDataSchema
// ---------------------------------------------------------------------------

describe("wizardStepDataSchema", () => {
  const validStep = {
    stepId: "context" as const,
    title: "Project Context",
    goal: "Understand the project",
    currentData: "Some data here",
    note: "A note"
  };

  it("accepts valid step data", () => {
    const result = wizardStepDataSchema.safeParse(validStep);
    expect(result.success).toBe(true);
  });

  it("accepts all valid stepId enum values", () => {
    const validStepIds = [
      "context",
      "goals",
      "constraints",
      "priorities",
      "success",
      "review"
    ];
    for (const stepId of validStepIds) {
      const result = wizardStepDataSchema.safeParse({
        ...validStep,
        stepId
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid stepId", () => {
    const result = wizardStepDataSchema.safeParse({
      ...validStep,
      stepId: "invalid_step"
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = wizardStepDataSchema.safeParse({
      ...validStep,
      title: ""
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty goal", () => {
    const result = wizardStepDataSchema.safeParse({
      ...validStep,
      goal: ""
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty currentData", () => {
    const result = wizardStepDataSchema.safeParse({
      ...validStep,
      currentData: ""
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty note (no min constraint)", () => {
    const result = wizardStepDataSchema.safeParse({
      ...validStep,
      note: ""
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing stepId", () => {
    const { stepId: _, ...rest } = validStep;
    const result = wizardStepDataSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const { title: _, ...rest } = validStep;
    const result = wizardStepDataSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-string title", () => {
    const result = wizardStepDataSchema.safeParse({
      ...validStep,
      title: 42
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getWizardGuidanceInputSchema
// ---------------------------------------------------------------------------

describe("getWizardGuidanceInputSchema", () => {
  const validStep = {
    stepId: "context" as const,
    title: "Project Context",
    goal: "Understand the project",
    currentData: "Some data here",
    note: ""
  };

  const validInput = {
    projectPath: "/project",
    draftPrompt: "Help me build an app",
    step: validStep,
    allSteps: [validStep]
  };

  it("accepts valid full input", () => {
    const result = getWizardGuidanceInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty draftPrompt", () => {
    const result = getWizardGuidanceInputSchema.safeParse({
      ...validInput,
      draftPrompt: ""
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty allSteps array", () => {
    const result = getWizardGuidanceInputSchema.safeParse({
      ...validInput,
      allSteps: []
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing step", () => {
    const { step: _, ...rest } = validInput;
    const result = getWizardGuidanceInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing allSteps", () => {
    const { allSteps: _, ...rest } = validInput;
    const result = getWizardGuidanceInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing projectPath", () => {
    const { projectPath: _, ...rest } = validInput;
    const result = getWizardGuidanceInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts empty projectPath string", () => {
    const result = getWizardGuidanceInputSchema.safeParse({
      ...validInput,
      projectPath: ""
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid step within allSteps", () => {
    const result = getWizardGuidanceInputSchema.safeParse({
      ...validInput,
      allSteps: [{ stepId: "invalid", title: "", goal: "", currentData: "", note: "" }]
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// inferStackInputSchema
// ---------------------------------------------------------------------------

describe("inferStackInputSchema", () => {
  const validInput = {
    projectMode: "existing" as const,
    projectPath: "/my/project",
    projectGoal: "Build a task manager",
    constraints: "Must use React",
    currentStack: "React, TypeScript"
  };

  it("accepts valid input with 'existing' mode", () => {
    const result = inferStackInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts valid input with 'new' mode", () => {
    const result = inferStackInputSchema.safeParse({
      ...validInput,
      projectMode: "new"
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid projectMode", () => {
    const result = inferStackInputSchema.safeParse({
      ...validInput,
      projectMode: "invalid"
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty projectGoal", () => {
    const result = inferStackInputSchema.safeParse({
      ...validInput,
      projectGoal: ""
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing projectGoal", () => {
    const { projectGoal: _, ...rest } = validInput;
    const result = inferStackInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts empty constraints", () => {
    const result = inferStackInputSchema.safeParse({
      ...validInput,
      constraints: ""
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty currentStack", () => {
    const result = inferStackInputSchema.safeParse({
      ...validInput,
      currentStack: ""
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty projectPath", () => {
    const result = inferStackInputSchema.safeParse({
      ...validInput,
      projectPath: ""
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing projectMode", () => {
    const { projectMode: _, ...rest } = validInput;
    const result = inferStackInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateModelConfigInputSchema
// ---------------------------------------------------------------------------

describe("updateModelConfigInputSchema", () => {
  it("accepts valid discovery_specialist role", () => {
    const result = updateModelConfigInputSchema.safeParse({
      agentRole: "discovery_specialist",
      modelId: "claude-opus-4-20250514"
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid plan_synthesis role", () => {
    const result = updateModelConfigInputSchema.safeParse({
      agentRole: "plan_synthesis",
      modelId: "claude-sonnet-4-20250514"
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid task_execution role", () => {
    const result = updateModelConfigInputSchema.safeParse({
      agentRole: "task_execution",
      modelId: "claude-opus-4-20250514"
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid agentRole", () => {
    const result = updateModelConfigInputSchema.safeParse({
      agentRole: "invalid_role",
      modelId: "claude-opus-4-20250514"
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty modelId", () => {
    const result = updateModelConfigInputSchema.safeParse({
      agentRole: "discovery_specialist",
      modelId: ""
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing agentRole", () => {
    const result = updateModelConfigInputSchema.safeParse({
      modelId: "claude-opus-4-20250514"
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing modelId", () => {
    const result = updateModelConfigInputSchema.safeParse({
      agentRole: "discovery_specialist"
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// discoveryResumeInputSchema
// ---------------------------------------------------------------------------

describe("discoveryResumeInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = discoveryResumeInputSchema.safeParse({
      sessionId: VALID_UUID
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = discoveryResumeInputSchema.safeParse({
      sessionId: INVALID_UUID
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing sessionId", () => {
    const result = discoveryResumeInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty string sessionId", () => {
    const result = discoveryResumeInputSchema.safeParse({ sessionId: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// discoveryAbandonInputSchema
// ---------------------------------------------------------------------------

describe("discoveryAbandonInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = discoveryAbandonInputSchema.safeParse({
      sessionId: VALID_UUID
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = discoveryAbandonInputSchema.safeParse({
      sessionId: INVALID_UUID
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing sessionId", () => {
    const result = discoveryAbandonInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// discoveryCancelInputSchema
// ---------------------------------------------------------------------------

describe("discoveryCancelInputSchema", () => {
  it("accepts valid UUID", () => {
    const result = discoveryCancelInputSchema.safeParse({
      sessionId: VALID_UUID
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = discoveryCancelInputSchema.safeParse({
      sessionId: INVALID_UUID
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing sessionId", () => {
    const result = discoveryCancelInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects null sessionId", () => {
    const result = discoveryCancelInputSchema.safeParse({ sessionId: null });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IPC handler validation wrapper behavior
// ---------------------------------------------------------------------------

describe("IPC handler validation (schema.parse rejects before handler)", () => {
  it("createPlanInputSchema.parse throws on invalid input", () => {
    expect(() =>
      createPlanInputSchema.parse({ prdText: "short", projectPath: 123 })
    ).toThrow();
  });

  it("getPlanInputSchema.parse throws on non-UUID planId", () => {
    expect(() =>
      getPlanInputSchema.parse({ planId: "not-a-uuid" })
    ).toThrow();
  });

  it("runTaskInputSchema.parse throws on missing fields", () => {
    expect(() => runTaskInputSchema.parse({})).toThrow();
  });

  it("continueDiscoveryInputSchema.parse throws on empty answers", () => {
    expect(() =>
      continueDiscoveryInputSchema.parse({
        sessionId: VALID_UUID,
        answers: []
      })
    ).toThrow();
  });

  it("updateModelConfigInputSchema.parse throws on invalid role", () => {
    expect(() =>
      updateModelConfigInputSchema.parse({
        agentRole: "bad_role",
        modelId: "model"
      })
    ).toThrow();
  });

  it("startDiscoveryInputSchema.parse throws on short seedSentence", () => {
    expect(() =>
      startDiscoveryInputSchema.parse({
        projectPath: "/path",
        seedSentence: "ab",
        additionalContext: ""
      })
    ).toThrow();
  });

  it("inferStackInputSchema.parse throws on invalid projectMode", () => {
    expect(() =>
      inferStackInputSchema.parse({
        projectMode: "hybrid",
        projectPath: "/p",
        projectGoal: "Goal",
        constraints: "",
        currentStack: ""
      })
    ).toThrow();
  });

  it("wizardStepDataSchema.parse throws on invalid stepId enum value", () => {
    expect(() =>
      wizardStepDataSchema.parse({
        stepId: "nonexistent",
        title: "T",
        goal: "G",
        currentData: "D",
        note: ""
      })
    ).toThrow();
  });

  it("valid input does not throw and returns parsed data", () => {
    const input = {
      prdText: "This is a valid PRD text that is at least 20 characters long.",
      projectPath: "/some/project"
    };
    const result = createPlanInputSchema.parse(input);
    expect(result.prdText).toBe(input.prdText);
    expect(result.projectPath).toBe(input.projectPath);
  });
});
