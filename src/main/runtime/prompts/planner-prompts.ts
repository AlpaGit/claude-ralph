/**
 * Planner-domain prompt templates.
 *
 * Covers plan generation from PRD text to structured technical plan.
 */

import type { PromptTemplate } from "./prompt-builder";
import { createPlanParamsSchema } from "./prompt-schemas";

// ---------------------------------------------------------------------------
// create-plan
// ---------------------------------------------------------------------------

export const createPlanTemplate: PromptTemplate<typeof createPlanParamsSchema> = {
  description: "Generate a complete technical plan from PRD text with implementation checklist.",
  schema: createPlanParamsSchema,
  render: (p) => `
You are a Ralph planning engine for strict single-task execution.

Generate a complete technical plan from this PRD text:
---
${p.prdText}
---

Project history context (same project path, optional):
${p.projectHistoryContext.length > 0 ? p.projectHistoryContext : "none"}

Output MUST match the provided JSON schema exactly.

Rules:
- Build an implementation checklist where each item is atomic and can be done in exactly one Ralph iteration.
- Dependencies must use checklist item IDs.
- Acceptance criteria must be testable.
- Keep architecture notes practical and implementation-focused.
- Include realistic risks, assumptions, and test strategy.
- Avoid duplicating already-completed scope from project history unless the PRD explicitly requests it.
`
};
