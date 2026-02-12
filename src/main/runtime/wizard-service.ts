/**
 * WizardService — standalone class encapsulating the PRD wizard guidance flow.
 *
 * Extracted from RalphAgentService to satisfy the god-class decomposition
 * target in Track 1 of the v0.2.0 PRD.
 *
 * Responsibilities:
 * - getWizardGuidance: interactive PRD coaching that produces step-by-step
 *   guidance with structured JSON output
 *
 * Dependencies are injected via constructor:
 * - `ModelResolver` function to resolve agent-role → model-id
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { GetWizardGuidanceInput, WizardGuidanceResult } from "@shared/types";
import { baseOptions, type ModelResolver } from "./agent-constants";
import { wizardGuidanceJsonSchema, wizardGuidanceSchema } from "./agent-schemas";
import { tryParseStructuredOutputFromText } from "./agent-utils";

// ---------------------------------------------------------------------------
// WizardService
// ---------------------------------------------------------------------------

export class WizardService {
  private readonly getModel: ModelResolver;

  constructor(getModel: ModelResolver) {
    this.getModel = getModel;
  }

  async getWizardGuidance(input: GetWizardGuidanceInput): Promise<WizardGuidanceResult> {
    const allStepsSummary = input.allSteps
      .map(
        (step, index) =>
          `${index + 1}. [${step.stepId}] ${step.title}\nGoal: ${step.goal}\nAnswer: ${step.currentData}\nNote: ${
            step.note || "none"
          }`
      )
      .join("\n\n");

    const prompt = `
You are an interactive PRD planning coach.

You must help users build a complete, high-quality PRD prompt step by step.
Focus only on the current step, but use all prior steps for consistency.

Current step:
- stepId: ${input.step.stepId}
- title: ${input.step.title}
- goal: ${input.step.goal}
- currentData: ${input.step.currentData}
- note: ${input.step.note || "none"}

All steps summary:
${allStepsSummary}

Draft prompt so far:
---
${input.draftPrompt}
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
`;

    const cwd = input.projectPath.trim().length > 0 ? input.projectPath : process.cwd();
    let structuredOutput: unknown;
    let resultText = "";

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
        model: this.getModel("plan_synthesis"),
        cwd,
        maxTurns: 8,
        outputFormat: {
          type: "json_schema",
          schema: wizardGuidanceJsonSchema
        },
        agents: {
          "prd-interviewer": {
            description:
              "PRD interviewer agent specialized in extracting missing product and technical context.",
            prompt: `
You are a PRD interviewing specialist.
Given a current step and previous context, produce precise guidance that improves plan quality.
Optimize for actionable, implementation-ready outcomes.
`
          }
        }
      }
    })) {
      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput = resultMessage.structured_output ?? tryParseStructuredOutputFromText(resultText);
      }
    }

    if (!structuredOutput) {
      throw new Error("No structured wizard guidance output received.");
    }

    return wizardGuidanceSchema.parse(structuredOutput);
  }
}
