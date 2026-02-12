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
import { prompts, PROMPT_NAMES } from "./prompts";

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

    const prompt = prompts.render(PROMPT_NAMES.WIZARD_GUIDANCE, {
      stepId: input.step.stepId,
      stepTitle: input.step.title,
      stepGoal: input.step.goal,
      stepCurrentData: input.step.currentData,
      stepNote: input.step.note || "",
      allStepsSummary,
      draftPrompt: input.draftPrompt
    });

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
            prompt: prompts.render(PROMPT_NAMES.SUBAGENT_PRD_INTERVIEWER, {})
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
