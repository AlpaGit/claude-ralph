/**
 * Zod validation schemas and their pre-computed JSON schema equivalents
 * for all structured outputs used by the Ralph agent service.
 *
 * Each pair (fooSchema + fooJsonSchema) serves a distinct purpose:
 * - The Zod schema validates and types the parsed response at runtime.
 * - The JSON schema is passed to the Claude API `outputFormat` parameter
 *   so the model produces conforming JSON directly.
 */

import { z } from "zod";
import { MAX_DYNAMIC_DISCOVERY_AGENTS, STACK_SPECIALIST_ID } from "./agent-constants";

// ---------------------------------------------------------------------------
// Wizard guidance
// ---------------------------------------------------------------------------

export const wizardGuidanceSchema = z.object({
  nextQuestion: z.string().min(10),
  recommendation: z.string().min(20),
  rationale: z.string().min(20),
  completenessScore: z.number().min(0).max(100),
  missingPoints: z.array(z.string()).min(1),
  promptFragment: z.string().min(20),
  suggestedEdits: z.array(
    z.object({
      field: z.string().min(1),
      value: z.string().min(1),
      reason: z.string().min(5)
    })
  )
});

export const wizardGuidanceJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    nextQuestion: { type: "string" },
    recommendation: { type: "string" },
    rationale: { type: "string" },
    completenessScore: { type: "number" },
    missingPoints: {
      type: "array",
      items: { type: "string" }
    },
    promptFragment: { type: "string" },
    suggestedEdits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          value: { type: "string" },
          reason: { type: "string" }
        },
        required: ["field", "value", "reason"]
      }
    }
  },
  required: [
    "nextQuestion",
    "recommendation",
    "rationale",
    "completenessScore",
    "missingPoints",
    "promptFragment",
    "suggestedEdits"
  ]
} as const;

// ---------------------------------------------------------------------------
// Infer stack
// ---------------------------------------------------------------------------

export const inferStackSchema = z.object({
  recommendedStack: z.string().min(5),
  confidence: z.number().min(0).max(100),
  detectedSignals: z.array(z.string()),
  alternatives: z.array(
    z.object({
      name: z.string().min(1),
      why: z.string().min(5),
      tradeoffs: z.array(z.string())
    })
  ),
  followUpQuestions: z.array(z.string()),
  rationale: z.string().min(10)
});

export const inferStackJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendedStack: { type: "string" },
    confidence: { type: "number" },
    detectedSignals: {
      type: "array",
      items: { type: "string" }
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          why: { type: "string" },
          tradeoffs: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["name", "why", "tradeoffs"]
      }
    },
    followUpQuestions: {
      type: "array",
      items: { type: "string" }
    },
    rationale: { type: "string" }
  },
  required: [
    "recommendedStack",
    "confidence",
    "detectedSignals",
    "alternatives",
    "followUpQuestions",
    "rationale"
  ]
} as const;

// ---------------------------------------------------------------------------
// Discovery output
// ---------------------------------------------------------------------------

export const discoveryOutputSchema = z.object({
  directionSummary: z.string().min(20),
  inferredContext: z.object({
    stack: z.string().min(1),
    documentation: z.string().min(1),
    scope: z.string().min(1),
    painPoints: z.array(z.string()),
    constraints: z.array(z.string()),
    signals: z.array(z.string())
  }),
  questions: z.array(
    z.object({
      id: z.string().min(1),
      question: z.string().min(8),
      reason: z.string().min(8),
      question_type: z.literal("multiple_choice"),
      options: z.array(z.string()).min(4).max(5),
      recommendedOption: z.string().min(1),
      selectionMode: z.enum(["single", "multi"])
    })
  ),
  prdInputDraft: z.string().min(120),
  readinessScore: z.number().min(0).max(100),
  missingCriticalInfo: z.array(z.string())
});

export const discoveryOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    directionSummary: { type: "string" },
    inferredContext: {
      type: "object",
      additionalProperties: false,
      properties: {
        stack: { type: "string" },
        documentation: { type: "string" },
        scope: { type: "string" },
        painPoints: {
          type: "array",
          items: { type: "string" }
        },
        constraints: {
          type: "array",
          items: { type: "string" }
        },
        signals: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["stack", "documentation", "scope", "painPoints", "constraints", "signals"]
    },
    questions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          reason: { type: "string" },
          question_type: { type: "string", enum: ["multiple_choice"] },
          options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 5 },
          recommendedOption: { type: "string" },
          selectionMode: { type: "string", enum: ["single", "multi"] }
        },
        required: ["id", "question", "reason", "question_type", "options", "recommendedOption", "selectionMode"]
      }
    },
    prdInputDraft: { type: "string" },
    readinessScore: { type: "number" },
    missingCriticalInfo: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "directionSummary",
    "inferredContext",
    "questions",
    "prdInputDraft",
    "readinessScore",
    "missingCriticalInfo"
  ]
} as const;

// ---------------------------------------------------------------------------
// Specialist analysis
// ---------------------------------------------------------------------------

export const specialistAnalysisSchema = z.object({
  summary: z.string().min(10),
  findings: z.array(z.string()),
  signals: z.array(z.string()),
  painPoints: z.array(z.string()),
  constraints: z.array(z.string()),
  scopeHints: z.array(z.string()),
  stackHints: z.array(z.string()),
  documentationHints: z.array(z.string()),
  questions: z.array(z.string()),
  confidence: z.number().min(0).max(100)
});

export const specialistAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: { type: "string" }
    },
    signals: {
      type: "array",
      items: { type: "string" }
    },
    painPoints: {
      type: "array",
      items: { type: "string" }
    },
    constraints: {
      type: "array",
      items: { type: "string" }
    },
    scopeHints: {
      type: "array",
      items: { type: "string" }
    },
    stackHints: {
      type: "array",
      items: { type: "string" }
    },
    documentationHints: {
      type: "array",
      items: { type: "string" }
    },
    questions: {
      type: "array",
      items: { type: "string" }
    },
    confidence: { type: "number" }
  },
  required: [
    "summary",
    "findings",
    "signals",
    "painPoints",
    "constraints",
    "scopeHints",
    "stackHints",
    "documentationHints",
    "questions",
    "confidence"
  ]
} as const;

// ---------------------------------------------------------------------------
// Stack profile cache
// ---------------------------------------------------------------------------

export const stackProfileCacheSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  specialistId: z.literal(STACK_SPECIALIST_ID),
  stackSummary: z.string().min(1),
  stackHints: z.array(z.string()),
  signals: z.array(z.string()),
  confidence: z.number().min(0).max(100)
});

// ---------------------------------------------------------------------------
// Discovery agent plan
// ---------------------------------------------------------------------------

export const discoveryAgentPlanSchema = z.object({
  rationale: z.string().min(20),
  jobs: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(3),
        objective: z.string().min(20),
        producesStackProfile: z.boolean()
      })
    )
    .min(1)
    .max(MAX_DYNAMIC_DISCOVERY_AGENTS)
});

export const discoveryAgentPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rationale: { type: "string" },
    jobs: {
      type: "array",
      minItems: 1,
      maxItems: MAX_DYNAMIC_DISCOVERY_AGENTS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          objective: { type: "string" },
          producesStackProfile: { type: "boolean" }
        },
        required: ["id", "title", "objective", "producesStackProfile"]
      }
    }
  },
  required: ["rationale", "jobs"]
} as const;

// ---------------------------------------------------------------------------
// Architecture review
// ---------------------------------------------------------------------------

const architectureFindingSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  location: z.string().min(1),
  rule: z.enum(["boundary", "srp", "duplication", "solid", "other"]),
  message: z.string().min(8),
  recommendedAction: z.string().min(8)
});

export const architectureReviewSchema = z.object({
  status: z.enum(["pass", "pass_with_notes", "needs_refactor", "blocked"]),
  summary: z.string().min(10),
  findings: z.array(architectureFindingSchema),
  recommendedActions: z.array(z.string()),
  confidence: z.number().min(0).max(100)
});

export type ArchitectureReview = z.infer<typeof architectureReviewSchema>;

export const architectureReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["pass", "pass_with_notes", "needs_refactor", "blocked"]
    },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: {
            type: "string",
            enum: ["low", "medium", "high", "critical"]
          },
          location: { type: "string" },
          rule: {
            type: "string",
            enum: ["boundary", "srp", "duplication", "solid", "other"]
          },
          message: { type: "string" },
          recommendedAction: { type: "string" }
        },
        required: ["severity", "location", "rule", "message", "recommendedAction"]
      }
    },
    recommendedActions: {
      type: "array",
      items: { type: "string" }
    },
    confidence: { type: "number" }
  },
  required: ["status", "summary", "findings", "recommendedActions", "confidence"]
} as const;
