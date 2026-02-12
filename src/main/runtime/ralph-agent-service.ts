import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";
import { z } from "zod";
import type {
  DiscoveryAnswer,
  DiscoveryInferredContext,
  GetWizardGuidanceInput,
  InferStackInput,
  InferStackResult,
  RalphPlan,
  RalphTask,
  TodoItem,
  WizardGuidanceResult
} from "@shared/types";
import {
  technicalPackJsonSchema,
  technicalPackSchema,
  type TechnicalPackOutput
} from "./ralph-schema";

interface CreatePlanArgs {
  projectPath: string;
  prdText: string;
  onLog?: (line: string) => void;
}

interface CreatePlanResult {
  summary: string;
  technicalPack: TechnicalPackOutput;
}

interface RunTaskCallbacks {
  onLog: (line: string) => void;
  onTodo: (todos: TodoItem[]) => void;
  onSession: (sessionId: string) => void;
  onSubagent: (payload: unknown) => void;
  onQuery: (queryHandle: { interrupt: () => Promise<void> }) => void;
}

interface RunTaskArgs {
  plan: RalphPlan;
  task: RalphTask;
  callbacks: RunTaskCallbacks;
}

interface RunTaskResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
}

interface DiscoveryOutput {
  directionSummary: string;
  inferredContext: DiscoveryInferredContext;
  questions: Array<{
    id: string;
    question: string;
    reason: string;
  }>;
  prdInputDraft: string;
  readinessScore: number;
  missingCriticalInfo: string[];
}

interface DiscoveryStreamEvent {
  type: "status" | "log" | "agent";
  level: "info" | "error";
  message: string;
  agent?: string;
  details?: string;
}

interface DiscoveryCallbacks {
  onEvent: (event: DiscoveryStreamEvent) => void;
}

interface StartDiscoveryArgs {
  projectPath: string;
  seedSentence: string;
  additionalContext: string;
  callbacks?: DiscoveryCallbacks;
}

interface ContinueDiscoveryArgs extends StartDiscoveryArgs {
  answerHistory: DiscoveryAnswer[];
  latestAnswers: DiscoveryAnswer[];
}

type SpecialistAgentId =
  | "stack-analyst"
  | "docs-analyst"
  | "scope-analyst"
  | "pain-analyst"
  | "constraints-analyst";

interface SpecialistAnalysis {
  summary: string;
  findings: string[];
  signals: string[];
  painPoints: string[];
  constraints: string[];
  scopeHints: string[];
  stackHints: string[];
  documentationHints: string[];
  questions: string[];
  confidence: number;
}

interface SpecialistJob {
  id: SpecialistAgentId;
  title: string;
  objective: string;
}

const baseOptions: Pick<Options, "allowDangerouslySkipPermissions" | "permissionMode" | "settingSources"> = {
  allowDangerouslySkipPermissions: true,
  permissionMode: "bypassPermissions" as const,
  settingSources: ["project", "local", "user"]
};

const wizardGuidanceSchema = z.object({
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

const wizardGuidanceJsonSchema = {
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

const inferStackSchema = z.object({
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

const inferStackJsonSchema = {
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
      reason: z.string().min(8)
    })
  ),
  prdInputDraft: z.string().min(120),
  readinessScore: z.number().min(0).max(100),
  missingCriticalInfo: z.array(z.string())
});

const discoveryOutputJsonSchema = {
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
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          reason: { type: "string" }
        },
        required: ["id", "question", "reason"]
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

const specialistAnalysisSchema = z.object({
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

const specialistAnalysisJsonSchema = {
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

function extractTextDelta(message: unknown): string | null {
  const maybe = message as {
    type?: string;
    event?: { type?: string; delta?: { type?: string; text?: string } };
  };

  if (maybe.type !== "stream_event") {
    return null;
  }

  if (maybe.event?.type !== "content_block_delta") {
    return null;
  }

  if (maybe.event.delta?.type !== "text_delta") {
    return null;
  }

  return maybe.event.delta.text ?? null;
}

function extractAssistantToolBlocks(
  message: unknown
): Array<{ type: string; name?: string; input?: unknown }> {
  const maybe = message as {
    type?: string;
    message?: {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };
  };

  if (maybe.type !== "assistant" || !Array.isArray(maybe.message?.content)) {
    return [];
  }

  return maybe.message.content;
}

function resolveQueryCwd(projectPath: string): string {
  const normalized = projectPath.trim();
  if (normalized.length > 0 && existsSync(normalized)) {
    return normalized;
  }
  return process.cwd();
}

function formatAnswers(answers: DiscoveryAnswer[]): string {
  if (answers.length === 0) {
    return "No answers yet.";
  }

  return answers
    .map((item, index) => `${index + 1}. [${item.questionId}] ${item.answer}`)
    .join("\n");
}

const SPECIALIST_JOBS: SpecialistJob[] = [
  {
    id: "stack-analyst",
    title: "Stack analysis",
    objective:
      "Infer the real technology stack, core architecture style, and likely integration points from repository and context."
  },
  {
    id: "docs-analyst",
    title: "Documentation analysis",
    objective:
      "Assess documentation quality, identify missing decision-critical docs, and infer documentation gaps that would block implementation."
  },
  {
    id: "scope-analyst",
    title: "Scope analysis",
    objective:
      "Define likely scope boundaries, impacted components/services, and out-of-scope areas to prevent overreach."
  },
  {
    id: "pain-analyst",
    title: "Pain-point analysis",
    objective:
      "Identify likely reliability, delivery, and performance pain points plus plausible root-cause candidates."
  },
  {
    id: "constraints-analyst",
    title: "Constraint analysis",
    objective:
      "Identify hard constraints such as compatibility, migration, compliance, operational, and timeline/resource limits."
  }
];

export class RalphAgentService {
  async startDiscovery(args: StartDiscoveryArgs): Promise<DiscoveryOutput> {
    const hasProjectPath = args.projectPath.trim().length > 0 && existsSync(args.projectPath.trim());
    const cwd = resolveQueryCwd(args.projectPath);

    const prompt = `
Discovery context for PRD interview:

User seed sentence:
${args.seedSentence}

Additional user context:
${args.additionalContext || "none"}

Project path:
${args.projectPath || "(not provided)"}
Project mode:
${hasProjectPath ? "existing codebase" : "new/unspecified project"}

Phase:
- Initial discovery

Goal:
- Turn this short request into a precise execution-ready PRD input.
- Ask many high-impact clarification questions and remove ambiguity.
`;

    return await this.runDiscoveryPrompt(prompt, cwd, 24, args.callbacks);
  }

  async continueDiscovery(args: ContinueDiscoveryArgs): Promise<DiscoveryOutput> {
    const cwd = resolveQueryCwd(args.projectPath);

    const prompt = `
Discovery continuation context for PRD interview:

Original seed sentence:
${args.seedSentence}

Additional user context:
${args.additionalContext || "none"}

Project path:
${args.projectPath || "(not provided)"}

All answers so far:
${formatAnswers(args.answerHistory)}

Latest answers:
${formatAnswers(args.latestAnswers)}

Phase:
- Continue discovery with follow-up answers

Goal:
- Refine PRD direction with the new answers.
- Ask only unresolved high-impact follow-up questions.
- Produce an increasingly decision-complete PRD input draft.
`;

    return await this.runDiscoveryPrompt(prompt, cwd, 20, args.callbacks);
  }

  private async runDiscoveryPrompt(
    prompt: string,
    cwd: string,
    maxTurns: number,
    callbacks?: DiscoveryCallbacks
  ): Promise<DiscoveryOutput> {
    callbacks?.onEvent({
      type: "status",
      level: "info",
      message: "Launching specialist analyses in parallel..."
    });

    const specialistTurns = Math.max(8, Math.ceil(maxTurns * 0.6));
    const specialistResults = await Promise.allSettled(
      SPECIALIST_JOBS.map((job) =>
        this.runSpecialistAnalysis({
          job,
          prompt,
          cwd,
          maxTurns: specialistTurns,
          callbacks
        })
      )
    );

    const completedReports: Array<{ job: SpecialistJob; report: SpecialistAnalysis }> = [];
    for (const result of specialistResults) {
      if (result.status === "fulfilled") {
        completedReports.push(result.value);
      } else {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        callbacks?.onEvent({
          type: "agent",
          level: "error",
          message: `A specialist failed: ${reason}`
        });
      }
    }

    if (completedReports.length === 0) {
      throw new Error("All specialist analyses failed.");
    }

    callbacks?.onEvent({
      type: "status",
      level: "info",
      message: `Specialists completed (${completedReports.length}/${SPECIALIST_JOBS.length}). Synthesizing final PRD input...`
    });

    const specialistSummary = completedReports
      .map(
        ({ job, report }) =>
          `### ${job.id}\n` +
          JSON.stringify(
            {
              summary: report.summary,
              findings: report.findings,
              signals: report.signals,
              painPoints: report.painPoints,
              constraints: report.constraints,
              scopeHints: report.scopeHints,
              stackHints: report.stackHints,
              documentationHints: report.documentationHints,
              questions: report.questions,
              confidence: report.confidence
            },
            null,
            2
          )
      )
      .join("\n\n");

    const synthesisPrompt = `
You are a senior PRD discovery synthesizer.

${prompt}

Specialist outputs (parallel analyses):
${specialistSummary}

Synthesis requirements:
1) Merge specialist findings into one coherent direction summary.
2) Build inferredContext with practical stack/docs/scope/pain/constraints/signals.
3) Produce high-impact clarification questions:
   - initial discovery: 8 to 14 questions
   - continuation with strong readiness: fewer questions is allowed
4) Generate a polished prdInputDraft ready for plan generation.
5) readinessScore must reflect real confidence.
6) missingCriticalInfo must list blockers that can still change implementation decisions.
7) If any specialist failed, explicitly reflect uncertainty in missingCriticalInfo.
`;

    let structuredOutput: unknown;
    let logBuffer = "";

    for await (const message of query({
      prompt: synthesisPrompt,
      options: {
        ...baseOptions,
        cwd,
        maxTurns,
        includePartialMessages: true,
        outputFormat: {
          type: "json_schema",
          schema: discoveryOutputJsonSchema
        }
      }
    })) {
      const initMessage = message as { type?: string; subtype?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init") {
        callbacks?.onEvent({
          type: "status",
          level: "info",
          message: "Synthesis runtime initialized."
        });
      }

      const textChunk = extractTextDelta(message);
      if (textChunk) {
        logBuffer += textChunk;
        while (true) {
          const nextBreakIndex = logBuffer.indexOf("\n");
          if (nextBreakIndex === -1 && logBuffer.length < 220) {
            break;
          }

          const sliceAt = nextBreakIndex !== -1 && nextBreakIndex < 220 ? nextBreakIndex : 220;
          const part = logBuffer.slice(0, sliceAt).trim();
          logBuffer = logBuffer.slice(sliceAt + (sliceAt === nextBreakIndex ? 1 : 0));
          if (part.length > 0) {
            callbacks?.onEvent({
              type: "log",
              level: "info",
              message: `[synth] ${part}`
            });
          }
        }
      }

      const resultMessage = message as { type?: string; structured_output?: unknown };
      if (resultMessage.type === "result") {
        callbacks?.onEvent({
          type: "status",
          level: "info",
          message: "Structured discovery output received. Validating..."
        });
        structuredOutput = resultMessage.structured_output;
      }
    }

    const finalLog = logBuffer.trim();
    if (finalLog.length > 0) {
      callbacks?.onEvent({
        type: "log",
        level: "info",
        message: `[synth] ${finalLog}`
      });
    }

    if (!structuredOutput) {
      throw new Error("No structured discovery output received.");
    }

    return discoveryOutputSchema.parse(structuredOutput);
  }

  private async runSpecialistAnalysis(input: {
    job: SpecialistJob;
    prompt: string;
    cwd: string;
    maxTurns: number;
    callbacks?: DiscoveryCallbacks;
  }): Promise<{ job: SpecialistJob; report: SpecialistAnalysis }> {
    input.callbacks?.onEvent({
      type: "agent",
      level: "info",
      message: `Starting specialist agent: ${input.job.id}`,
      agent: input.job.id,
      details: input.job.title
    });

    const specialistPrompt = `
You are specialist agent "${input.job.id}".

${input.prompt}

Specialist objective:
${input.job.objective}

Output requirements:
- Return structured JSON only.
- Be concrete and evidence-oriented.
- Prefer repository signals when a project path exists.
- Include unresolved questions that materially affect implementation decisions.
`;

    let structuredOutput: unknown;
    let logBuffer = "";

    for await (const message of query({
      prompt: specialistPrompt,
      options: {
        ...baseOptions,
        cwd: input.cwd,
        maxTurns: input.maxTurns,
        includePartialMessages: true,
        outputFormat: {
          type: "json_schema",
          schema: specialistAnalysisJsonSchema
        }
      }
    })) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        logBuffer += textChunk;
        while (true) {
          const nextBreakIndex = logBuffer.indexOf("\n");
          if (nextBreakIndex === -1 && logBuffer.length < 220) {
            break;
          }

          const sliceAt = nextBreakIndex !== -1 && nextBreakIndex < 220 ? nextBreakIndex : 220;
          const part = logBuffer.slice(0, sliceAt).trim();
          logBuffer = logBuffer.slice(sliceAt + (sliceAt === nextBreakIndex ? 1 : 0));
          if (part.length > 0) {
            input.callbacks?.onEvent({
              type: "log",
              level: "info",
              message: `[${input.job.id}] ${part}`,
              agent: input.job.id
            });
          }
        }
      }

      const resultMessage = message as { type?: string; structured_output?: unknown };
      if (resultMessage.type === "result") {
        structuredOutput = resultMessage.structured_output;
      }
    }

    const finalLog = logBuffer.trim();
    if (finalLog.length > 0) {
      input.callbacks?.onEvent({
        type: "log",
        level: "info",
        message: `[${input.job.id}] ${finalLog}`,
        agent: input.job.id
      });
    }

    if (!structuredOutput) {
      throw new Error(`${input.job.id} produced no structured output.`);
    }

    const report = specialistAnalysisSchema.parse(structuredOutput);
    input.callbacks?.onEvent({
      type: "agent",
      level: "info",
      message: `Completed specialist agent: ${input.job.id} (${report.confidence}% confidence)`,
      agent: input.job.id
    });

    return {
      job: input.job,
      report
    };
  }

  async inferStack(input: InferStackInput): Promise<InferStackResult> {
    const normalizedPath = input.projectPath.trim();
    const cwd =
      input.projectMode === "existing" && normalizedPath.length > 0
        ? resolveQueryCwd(normalizedPath)
        : process.cwd();

    const prompt =
      input.projectMode === "existing"
        ? `
You are a software architecture analyst.

Task: infer the real technology stack from this existing codebase and recommend the best stack summary for PRD planning.

Inputs:
- projectPath: ${normalizedPath || "(not provided)"}
- projectGoal: ${input.projectGoal}
- constraints: ${input.constraints || "none"}
- currentStackHint: ${input.currentStack || "none"}

Instructions:
1) Inspect repository signals (configs, manifests, lockfiles, src structure) before concluding.
2) Return one recommendedStack string suitable for a PRD.
3) Include detectedSignals that justify your conclusion.
4) Provide alternatives only if uncertainty exists.
5) Include follow-up questions when critical info is missing.
6) Use the "stack-architect" subagent via Task for focused analysis.
`
        : `
You are a software architecture advisor for a new project.

Task: suggest the most suitable initial stack based on product intent and constraints.

Inputs:
- projectGoal: ${input.projectGoal}
- constraints: ${input.constraints || "none"}
- currentStackHint: ${input.currentStack || "none"}

Instructions:
1) Recommend one default stack with practical rationale.
2) Provide 2-3 alternatives with tradeoffs.
3) Ask high-impact follow-up questions to clarify needs/wants.
4) Include confidence score.
5) Use the "stack-architect" subagent via Task for focused reasoning.
`;

    let structuredOutput: unknown;

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
        cwd,
        maxTurns: 10,
        outputFormat: {
          type: "json_schema",
          schema: inferStackJsonSchema
        },
        agents: {
          "stack-architect": {
            description: "Architecture specialist for stack selection and codebase stack inference.",
            prompt: `
You infer technology stacks from code artifacts and recommend pragmatic defaults.
Prefer concrete evidence and practical tradeoffs.
`
          }
        }
      }
    })) {
      const resultMessage = message as { type?: string; structured_output?: unknown };
      if (resultMessage.type === "result") {
        structuredOutput = resultMessage.structured_output;
      }
    }

    if (!structuredOutput) {
      throw new Error("No structured stack inference output received.");
    }

    return inferStackSchema.parse(structuredOutput);
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

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
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
      const resultMessage = message as { type?: string; structured_output?: unknown };
      if (resultMessage.type === "result") {
        structuredOutput = resultMessage.structured_output;
      }
    }

    if (!structuredOutput) {
      throw new Error("No structured wizard guidance output received.");
    }

    return wizardGuidanceSchema.parse(structuredOutput);
  }

  async createPlan(args: CreatePlanArgs): Promise<CreatePlanResult> {
    const cwd = resolveQueryCwd(args.projectPath);
    const prompt = `
You are a Ralph planning engine for strict single-task execution.

Generate a complete technical plan from this PRD text:
---
${args.prdText}
---

Output MUST match the provided JSON schema exactly.

Rules:
- Build an implementation checklist where each item is atomic and can be done in exactly one Ralph iteration.
- Dependencies must use checklist item IDs.
- Acceptance criteria must be testable.
- Keep architecture notes practical and implementation-focused.
- Include realistic risks, assumptions, and test strategy.
`;

    let structuredOutput: unknown;

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
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

      const resultMessage = message as { type?: string; structured_output?: unknown };
      if (resultMessage.type === "result") {
        structuredOutput = resultMessage.structured_output;
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

  async runTask(args: RunTaskArgs): Promise<RunTaskResult> {
    const cwd = resolveQueryCwd(args.plan.projectPath);
    const clearResponse = query({
      prompt: "/clear",
      options: {
        ...baseOptions,
        cwd,
        maxTurns: 1
      }
    });

    let clearSessionId: string | null = null;
    for await (const message of clearResponse) {
      const initMessage = message as { type?: string; subtype?: string; session_id?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
        clearSessionId = initMessage.session_id;
      }
    }

    if (!clearSessionId) {
      throw new Error("Unable to start a cleared task session.");
    }

    const taskPrompt = `
You are executing a strict Ralph iteration.

Plan summary:
${args.plan.summary}

Task to execute now (ONLY this task):
- Task ID: ${args.task.id}
- Title: ${args.task.title}
- Description: ${args.task.description}
- Dependencies already completed: ${
      args.task.dependencies.length > 0 ? args.task.dependencies.join(", ") : "none"
    }

Technical notes:
${args.task.technicalNotes}

Strict workflow:
1) Read PRD.md (or equivalent PRD context in repo).
2) Read progress.txt.
3) Implement only this task.
4) Run build and required tests. Use the project's build and test commands as detected from project configuration files (package.json, Cargo.toml, Makefile, etc.) or as specified in the plan's technical notes.
5) Commit with Ralph format.
6) Append progress entry in Ralph format.
7) Stop.

Hard rules:
- Do not implement additional tasks.
- Use TodoWrite to track progress.
- If build/tests fail and quick fix is impossible, revert partial task changes, write failure note in progress.txt, and stop.
- Return a concise final report including changed files, commit hash, and appended progress entry.

Execution instruction:
- Use the "ralph-worker" agent via Task for focused implementation.
`;

    let runSessionId: string | null = clearSessionId;
    let resultText = "";
    let stopReason: string | null = null;
    let totalCostUsd: number | null = null;
    let durationMs: number | null = null;

    const runResponse = query({
      prompt: taskPrompt,
      options: {
        ...baseOptions,
        cwd,
        resume: clearSessionId,
        includePartialMessages: true,
        maxTurns: 60,
        agents: {
          "ralph-worker": {
            description: "Strict Ralph implementation worker for one checklist item.",
            prompt: `
You execute one Ralph task at a time with strict compliance.
Stay scoped to the requested checklist item only.
Provide clear final implementation report.
`,
            model: "inherit"
          }
        }
      }
    });

    args.callbacks.onQuery(runResponse);

    for await (const message of runResponse) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        args.callbacks.onLog(textChunk);
      }

      const initMessage = message as { type?: string; subtype?: string; session_id?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
        runSessionId = initMessage.session_id;
        args.callbacks.onSession(runSessionId);
      }

      const blocks = extractAssistantToolBlocks(message);
      for (const block of blocks) {
        if (block.type !== "tool_use" || !block.name) {
          continue;
        }

        if (block.name === "TodoWrite") {
          const input = block.input as { todos?: TodoItem[] } | undefined;
          if (Array.isArray(input?.todos)) {
            args.callbacks.onTodo(input.todos);
          }
        }

        if (block.name === "Task") {
          args.callbacks.onSubagent(block.input ?? {});
        }
      }

      const resultMessage = message as {
        type?: string;
        result?: string;
        stop_reason?: string | null;
        total_cost_usd?: number;
        duration_ms?: number;
      };

      if (resultMessage.type === "result") {
        resultText = resultMessage.result ?? "";
        stopReason = resultMessage.stop_reason ?? null;
        totalCostUsd = resultMessage.total_cost_usd ?? null;
        durationMs = resultMessage.duration_ms ?? null;
      }
    }

    return {
      sessionId: runSessionId,
      resultText,
      stopReason,
      durationMs,
      totalCostUsd
    };
  }
}
