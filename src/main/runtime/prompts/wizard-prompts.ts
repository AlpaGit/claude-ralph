/**
 * Wizard-domain prompt templates.
 *
 * Covers the interactive PRD coaching flow that produces step-by-step
 * guidance with structured JSON output.
 */

import type { PromptTemplate } from "./prompt-builder";
import { wizardGuidanceParamsSchema } from "./prompt-schemas";

// ---------------------------------------------------------------------------
// wizard-guidance
// ---------------------------------------------------------------------------

export const wizardGuidanceTemplate: PromptTemplate<typeof wizardGuidanceParamsSchema> = {
  description: "Interactive PRD planning coach that provides step-by-step guidance for building a complete PRD.",
  schema: wizardGuidanceParamsSchema,
  render: (p) => `
You are an interactive PRD planning coach.

You must help users build a complete, high-quality PRD prompt step by step.
Focus only on the current step, but use all prior steps for consistency.

Current step:
- stepId: ${p.stepId}
- title: ${p.stepTitle}
- goal: ${p.stepGoal}
- currentData: ${p.stepCurrentData}
- note: ${p.stepNote || "none"}

All steps summary:
${p.allStepsSummary}

Draft prompt so far:
---
${p.draftPrompt}
---

Instructions:
1) Ask one high-impact next question that unlocks better technical decisions.
2) Provide a concrete recommendation for this step (not generic advice).
3) Explain rationale and tradeoff briefly.
4) Score completeness 0-100 for this step only.
5) List missing points that should be added before finalizing.
6) Provide a polished prompt fragment the user can paste into the PRD prompt.
7) Provide suggestedEdits with explicit field names from the step data when possible.

Important:
- Keep output concise and actionable.
- Avoid repeating the entire PRD.
- Treat this as an iterative interview.
- Use the "prd-interviewer" agent via Task to reason deeply before returning final guidance.
`
};
