/**
 * Unit tests for the discoveryOutputSchema validation logic.
 *
 * The schema is private to ralph-agent-service.ts, so we replicate its
 * Zod definition here to test the exact constraints that disc-002 enforces:
 *   - question_type must be "multiple_choice"
 *   - options array must have 4–5 items
 *   - recommendedOption is a non-empty required string
 *   - selectionMode must be "single" | "multi"
 *   - post-processing clamps questions to exactly 3
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Replicate the discoveryOutputSchema from ralph-agent-service.ts (disc-002)
// ---------------------------------------------------------------------------

const discoveryOutputSchema = z.object({
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-1",
    question: "What is the target deployment platform?",
    reason: "Deployment platform drives infrastructure decisions.",
    question_type: "multiple_choice",
    options: ["AWS", "GCP", "Azure", "On-premise"],
    recommendedOption: "AWS",
    selectionMode: "single",
    ...overrides
  };
}

function makeValidOutput(overrides: Record<string, unknown> = {}) {
  return {
    directionSummary: "A sufficiently long direction summary for the discovery output validation test.",
    inferredContext: {
      stack: "TypeScript, React",
      documentation: "README exists",
      scope: "Web application",
      painPoints: ["Slow builds"],
      constraints: ["Must ship by Q3"],
      signals: ["Vite config detected"]
    },
    questions: [
      makeValidQuestion({ id: "q-1" }),
      makeValidQuestion({ id: "q-2", selectionMode: "multi" }),
      makeValidQuestion({ id: "q-3" })
    ],
    prdInputDraft: "A".repeat(120), // exactly 120 chars
    readinessScore: 55,
    missingCriticalInfo: ["Auth provider decision"],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Valid inputs
// ---------------------------------------------------------------------------

describe("discoveryOutputSchema – valid inputs", () => {
  it("accepts a fully valid output with 3 multiple-choice questions", () => {
    const result = discoveryOutputSchema.safeParse(makeValidOutput());
    expect(result.success).toBe(true);
  });

  it("accepts questions with 5 options", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [
          makeValidQuestion({ id: "q-1", options: ["A", "B", "C", "D", "E"] }),
          makeValidQuestion({ id: "q-2", options: ["A", "B", "C", "D", "E"] }),
          makeValidQuestion({ id: "q-3" })
        ]
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts selectionMode 'multi'", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [
          makeValidQuestion({ id: "q-1", selectionMode: "multi" }),
          makeValidQuestion({ id: "q-2", selectionMode: "multi" }),
          makeValidQuestion({ id: "q-3", selectionMode: "single" })
        ]
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts 0 questions (post-processing handles padding)", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({ questions: [] })
    );
    expect(result.success).toBe(true);
  });

  it("accepts more than 3 questions (post-processing handles trimming)", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [
          makeValidQuestion({ id: "q-1" }),
          makeValidQuestion({ id: "q-2" }),
          makeValidQuestion({ id: "q-3" }),
          makeValidQuestion({ id: "q-4" }),
          makeValidQuestion({ id: "q-5" })
        ]
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts readinessScore at boundaries (0 and 100)", () => {
    expect(
      discoveryOutputSchema.safeParse(makeValidOutput({ readinessScore: 0 })).success
    ).toBe(true);
    expect(
      discoveryOutputSchema.safeParse(makeValidOutput({ readinessScore: 100 })).success
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// question_type enforcement
// ---------------------------------------------------------------------------

describe("discoveryOutputSchema – question_type enforcement", () => {
  it("rejects question_type 'text'", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [makeValidQuestion({ id: "q-1", question_type: "text" })]
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.includes("question_type")
      );
      expect(issue).toBeDefined();
    }
  });

  it("rejects missing question_type", () => {
    const q = makeValidQuestion({ id: "q-1" });
    delete (q as Record<string, unknown>).question_type;
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({ questions: [q] })
    );
    expect(result.success).toBe(false);
  });

  it("rejects question_type with arbitrary string", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [makeValidQuestion({ id: "q-1", question_type: "free_form" })]
      })
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// options array enforcement (4–5 items)
// ---------------------------------------------------------------------------

describe("discoveryOutputSchema – options array enforcement", () => {
  it("rejects options with fewer than 4 items", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [
          makeValidQuestion({ id: "q-1", options: ["A", "B", "C"] })
        ]
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("options"));
      expect(issue).toBeDefined();
    }
  });

  it("rejects options with more than 5 items", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [
          makeValidQuestion({
            id: "q-1",
            options: ["A", "B", "C", "D", "E", "F"]
          })
        ]
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects empty options array", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [makeValidQuestion({ id: "q-1", options: [] })]
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects missing options field", () => {
    const q = makeValidQuestion({ id: "q-1" });
    delete (q as Record<string, unknown>).options;
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({ questions: [q] })
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recommendedOption enforcement
// ---------------------------------------------------------------------------

describe("discoveryOutputSchema – recommendedOption enforcement", () => {
  it("rejects empty recommendedOption", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [makeValidQuestion({ id: "q-1", recommendedOption: "" })]
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects null recommendedOption", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [makeValidQuestion({ id: "q-1", recommendedOption: null })]
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects missing recommendedOption", () => {
    const q = makeValidQuestion({ id: "q-1" });
    delete (q as Record<string, unknown>).recommendedOption;
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({ questions: [q] })
    );
    expect(result.success).toBe(false);
  });

  it("accepts recommendedOption that matches an option value", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [
          makeValidQuestion({
            id: "q-1",
            options: ["Alpha", "Beta", "Gamma", "Delta"],
            recommendedOption: "Beta"
          })
        ]
      })
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selectionMode enforcement
// ---------------------------------------------------------------------------

describe("discoveryOutputSchema – selectionMode enforcement", () => {
  it("rejects invalid selectionMode value", () => {
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({
        questions: [
          makeValidQuestion({ id: "q-1", selectionMode: "multiple" })
        ]
      })
    );
    expect(result.success).toBe(false);
  });

  it("rejects missing selectionMode", () => {
    const q = makeValidQuestion({ id: "q-1" });
    delete (q as Record<string, unknown>).selectionMode;
    const result = discoveryOutputSchema.safeParse(
      makeValidOutput({ questions: [q] })
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Post-processing simulation (batch size clamping)
// ---------------------------------------------------------------------------

describe("discoveryOutputSchema – post-processing batch clamping", () => {
  const BATCH_SIZE = 3;

  const FALLBACK_QUESTIONS = [
    {
      id: "fallback-scope",
      question: "How would you describe the overall scope of this project?",
      reason: "Scope clarity helps narrow implementation decisions.",
      question_type: "multiple_choice" as const,
      options: [
        "Small feature addition",
        "Medium feature set",
        "Large system overhaul",
        "Greenfield application"
      ],
      recommendedOption: "Medium feature set",
      selectionMode: "single" as const
    },
    {
      id: "fallback-priority",
      question: "What is most important for the first deliverable?",
      reason: "Prioritization drives task ordering in the plan.",
      question_type: "multiple_choice" as const,
      options: [
        "Speed of delivery",
        "Code quality and maintainability",
        "Feature completeness",
        "User experience polish"
      ],
      recommendedOption: "Feature completeness",
      selectionMode: "single" as const
    },
    {
      id: "fallback-constraints",
      question: "Are there any hard constraints on this project?",
      reason: "Constraints materially affect architecture and implementation choices.",
      question_type: "multiple_choice" as const,
      options: [
        "Must use existing tech stack only",
        "Strict deadline within 1–2 weeks",
        "Must maintain backward compatibility",
        "No significant constraints"
      ],
      recommendedOption: "No significant constraints",
      selectionMode: "multi" as const
    }
  ];

  function clampQuestions(
    questions: Array<ReturnType<typeof makeValidQuestion>>
  ) {
    if (questions.length > BATCH_SIZE) {
      return questions.slice(0, BATCH_SIZE);
    }
    if (questions.length < BATCH_SIZE) {
      const existingIds = new Set(questions.map((q) => q.id));
      const result = [...questions];
      for (const fallback of FALLBACK_QUESTIONS) {
        if (result.length >= BATCH_SIZE) break;
        if (!existingIds.has(fallback.id)) {
          result.push(fallback);
        }
      }
      return result;
    }
    return questions;
  }

  it("trims 5 questions to 3", () => {
    const questions = Array.from({ length: 5 }, (_, i) =>
      makeValidQuestion({ id: `q-${i + 1}` })
    );
    const clamped = clampQuestions(questions);
    expect(clamped).toHaveLength(BATCH_SIZE);
    expect(clamped.map((q) => q.id)).toEqual(["q-1", "q-2", "q-3"]);
  });

  it("pads 1 question to 3 with fallbacks", () => {
    const questions = [makeValidQuestion({ id: "q-1" })];
    const clamped = clampQuestions(questions);
    expect(clamped).toHaveLength(BATCH_SIZE);
    expect(clamped[0].id).toBe("q-1");
    expect(clamped[1].id).toBe("fallback-scope");
    expect(clamped[2].id).toBe("fallback-priority");
  });

  it("pads 0 questions to 3 with all fallbacks", () => {
    const clamped = clampQuestions([]);
    expect(clamped).toHaveLength(BATCH_SIZE);
    expect(clamped.map((q) => q.id)).toEqual([
      "fallback-scope",
      "fallback-priority",
      "fallback-constraints"
    ]);
  });

  it("does not duplicate existing ids during padding", () => {
    const questions = [makeValidQuestion({ id: "fallback-scope" })];
    const clamped = clampQuestions(questions);
    expect(clamped).toHaveLength(BATCH_SIZE);
    // fallback-scope already exists, so should skip it
    expect(clamped.map((q) => q.id)).toEqual([
      "fallback-scope",
      "fallback-priority",
      "fallback-constraints"
    ]);
  });

  it("keeps exactly 3 questions unchanged", () => {
    const questions = [
      makeValidQuestion({ id: "q-1" }),
      makeValidQuestion({ id: "q-2" }),
      makeValidQuestion({ id: "q-3" })
    ];
    const clamped = clampQuestions(questions);
    expect(clamped).toHaveLength(BATCH_SIZE);
    expect(clamped).toEqual(questions);
  });

  it("all fallback questions pass schema validation", () => {
    for (const fb of FALLBACK_QUESTIONS) {
      const questionSchema = discoveryOutputSchema.shape.questions.element;
      const result = questionSchema.safeParse(fb);
      expect(result.success).toBe(true);
    }
  });
});
