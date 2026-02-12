/**
 * PlannerAgent — standalone class encapsulating PRD-to-plan generation.
 *
 * Extracted from RalphAgentService to satisfy the god-class decomposition
 * target in Track 1 of the v0.2.0 PRD.
 *
 * Responsibilities:
 * - createPlan: generates a structured technical plan from PRD text
 *
 * Dependencies are injected via constructor:
 * - `ModelResolver` function to resolve agent-role → model-id
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  technicalPackJsonSchema,
  technicalPackSchema,
  type TechnicalPackOutput
} from "./ralph-schema";
import { baseOptions, type ModelResolver } from "./agent-constants";
import {
  extractTextDelta,
  resolveQueryCwd,
  tryParseStructuredOutputFromText
} from "./agent-utils";

// ---------------------------------------------------------------------------
// Re-export for backward compatibility
// ---------------------------------------------------------------------------

export type { ModelResolver } from "./agent-constants";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreatePlanArgs {
  projectPath: string;
  prdText: string;
  projectHistoryContext?: string;
  onLog?: (line: string) => void;
}

export interface CreatePlanResult {
  summary: string;
  technicalPack: TechnicalPackOutput;
}

// ---------------------------------------------------------------------------
// PlannerAgent
// ---------------------------------------------------------------------------

export class PlannerAgent {
  private readonly getModel: ModelResolver;

  constructor(getModel: ModelResolver) {
    this.getModel = getModel;
  }

  async createPlan(args: CreatePlanArgs): Promise<CreatePlanResult> {
    const cwd = resolveQueryCwd(args.projectPath);
    const projectHistoryContext = args.projectHistoryContext?.trim() ?? "";
    const prompt = `
You are a Ralph planning engine for strict single-task execution.

Generate a complete technical plan from this PRD text:
---
${args.prdText}
---

Project history context (same project path, optional):
${projectHistoryContext.length > 0 ? projectHistoryContext : "none"}

Output MUST match the provided JSON schema exactly.

Rules:
- Build an implementation checklist where each item is atomic and can be done in exactly one Ralph iteration.
- Dependencies must use checklist item IDs.
- Acceptance criteria must be testable.
- Keep architecture notes practical and implementation-focused.
- Include realistic risks, assumptions, and test strategy.
- Avoid duplicating already-completed scope from project history unless the PRD explicitly requests it.
`;

    let structuredOutput: unknown;
    let resultText = "";

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
        model: this.getModel("plan_synthesis"),
        cwd,
        includePartialMessages: true,
        maxTurns: 10,
        outputFormat: {
          type: "json_schema",
          schema: technicalPackJsonSchema
        }
      }
    })) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        args.onLog?.(textChunk);
      }

      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput = resultMessage.structured_output ?? tryParseStructuredOutputFromText(resultText);
      }
    }

    if (!structuredOutput) {
      throw new Error("No structured output received while creating the Ralph plan.");
    }

    const technicalPack = technicalPackSchema.parse(structuredOutput);
    return {
      summary: technicalPack.summary,
      technicalPack
    };
  }
}
