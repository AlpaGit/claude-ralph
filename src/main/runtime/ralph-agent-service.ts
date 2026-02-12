import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import type {
  AgentRole,
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

/** Map of agent role to model ID, loaded from model_config DB table. */
export type ModelConfigMap = Map<AgentRole, string>;

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

interface RetryContext {
  retryCount: number;
  previousError: string;
}

interface RunTaskArgs {
  plan: RalphPlan;
  task: RalphTask;
  callbacks: RunTaskCallbacks;
  retryContext?: RetryContext;
  workingDirectory?: string;
  branchName?: string;
  phaseNumber?: number;
}

interface RunTaskResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
}

interface CommitterCallbacks {
  onLog: (line: string) => void;
  onQuery: (queryHandle: { interrupt: () => Promise<void> }) => void;
}

interface MergePhaseArgs {
  repoRoot: string;
  targetBranch: string;
  branches: string[];
  phaseNumber: number;
  callbacks: CommitterCallbacks;
}

interface MergePhaseResult {
  sessionId: string | null;
  resultText: string;
  stopReason: string | null;
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

const MAX_ARCH_REFACTOR_CYCLES = 2;
const CONVENTIONAL_COMMIT_HEADER = /^[a-z]+(?:\([^)]+\))?!?: .+/;
const CLAUDE_COAUTHOR_TRAILER = /co-authored-by:\s*.*claude/i;

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

const architectureFindingSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  location: z.string().min(1),
  rule: z.enum(["boundary", "srp", "duplication", "solid", "other"]),
  message: z.string().min(8),
  recommendedAction: z.string().min(8)
});

const architectureReviewSchema = z.object({
  status: z.enum(["pass", "pass_with_notes", "needs_refactor", "blocked"]),
  summary: z.string().min(10),
  findings: z.array(architectureFindingSchema),
  recommendedActions: z.array(z.string()),
  confidence: z.number().min(0).max(100)
});

type ArchitectureReview = z.infer<typeof architectureReviewSchema>;

const architectureReviewJsonSchema = {
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

function tryParseStructuredOutputFromText(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (value: string): void => {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  pushCandidate(trimmed);

  const fencedBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of trimmed.matchAll(fencedBlockRegex)) {
    if (typeof match[1] === "string") {
      pushCandidate(match[1]);
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    pushCandidate(trimmed.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    pushCandidate(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue trying other candidates.
    }
  }

  return null;
}

function normalizeConfidencePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 1) {
    return Math.max(0, Math.min(100, Math.round(value * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolveQueryCwd(projectPath: string): string {
  const normalized = projectPath.trim();
  if (normalized.length > 0 && existsSync(normalized)) {
    return normalized;
  }
  return process.cwd();
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const details = String(stderr ?? "").trim() || error.message;
          reject(new Error(`git ${args.join(" ")} failed in ${cwd}: ${details}`));
          return;
        }
        resolve(String(stdout ?? ""));
      }
    );
  });
}

async function readGitHeadCommit(cwd: string): Promise<string | null> {
  return await new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "HEAD"],
      {
        cwd,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(String(stdout ?? "").trim() || null);
      }
    );
  });
}

async function validateCommitPolicyForRange(cwd: string, range: string, context: string): Promise<void> {
  const output = await runGitCommand(cwd, ["log", "--format=%H%x1f%s%x1f%B%x1e", range]);
  const records = output
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (records.length === 0) {
    throw new Error(`No commits found in ${context}.`);
  }

  for (const record of records) {
    const [hash, subject = "", ...bodyParts] = record.split("\x1f");
    const body = bodyParts.join("\x1f");
    if (!CONVENTIONAL_COMMIT_HEADER.test(subject.trim())) {
      throw new Error(
        `Commit policy violation in ${context}: commit ${hash} is not Conventional Commit compliant.`
      );
    }
    if (CLAUDE_COAUTHOR_TRAILER.test(body)) {
      throw new Error(
        `Commit policy violation in ${context}: commit ${hash} includes forbidden Claude co-author trailer.`
      );
    }
  }
}

function summarizeArchitectureFindings(review: ArchitectureReview): string {
  if (review.findings.length === 0) {
    return review.summary;
  }
  return review.findings
    .map(
      (finding, index) =>
        `${index + 1}. [${finding.severity}] (${finding.rule}) ${finding.location}: ${finding.message}`
    )
    .join("\n");
}

const ARCHITECTURE_STATUS_RANK: Record<ArchitectureReview["status"], number> = {
  pass: 0,
  pass_with_notes: 1,
  needs_refactor: 2,
  blocked: 3
};

function mostRestrictiveStatus(
  left: ArchitectureReview["status"],
  right: ArchitectureReview["status"]
): ArchitectureReview["status"] {
  return ARCHITECTURE_STATUS_RANK[left] >= ARCHITECTURE_STATUS_RANK[right] ? left : right;
}

function mapStageToAgentRole(stageName: string): AgentRole {
  if (stageName === "tester") {
    return "tester";
  }
  if (stageName === "committer") {
    return "committer";
  }
  if (stageName.startsWith("architecture-review")) {
    return "architecture_specialist";
  }
  return "task_execution";
}

function enforceArchitectureQualityGate(review: ArchitectureReview): ArchitectureReview {
  const qualityRules = new Set(["boundary", "srp", "duplication", "solid"]);
  const hasCritical = review.findings.some((finding) => finding.severity === "critical");
  const hasHigh = review.findings.some((finding) => finding.severity === "high");
  const hasMediumQualityIssue = review.findings.some(
    (finding) => finding.severity === "medium" && qualityRules.has(finding.rule)
  );
  const hasQualityFinding = review.findings.some((finding) => qualityRules.has(finding.rule));
  const missingActions = review.findings.length > 0 && review.recommendedActions.length === 0;

  let enforcedStatus = review.status;
  const enforcementNotes: string[] = [];

  if (hasCritical) {
    enforcedStatus = mostRestrictiveStatus(enforcedStatus, "blocked");
    enforcementNotes.push("critical finding present");
  } else if (hasHigh || hasMediumQualityIssue || missingActions) {
    enforcedStatus = mostRestrictiveStatus(enforcedStatus, "needs_refactor");
    if (hasHigh) {
      enforcementNotes.push("high-severity finding present");
    }
    if (hasMediumQualityIssue) {
      enforcementNotes.push("medium-severity quality rule violation present");
    }
    if (missingActions) {
      enforcementNotes.push("missing recommended actions");
    }
  } else if (review.findings.length > 0 || (review.status === "pass" && hasQualityFinding)) {
    enforcedStatus = mostRestrictiveStatus(enforcedStatus, "pass_with_notes");
    enforcementNotes.push("non-critical findings present");
  } else {
    enforcedStatus = "pass";
  }

  if (enforcedStatus === review.status) {
    return review;
  }

  return {
    ...review,
    status: enforcedStatus,
    summary: `${review.summary} [quality gate enforced: ${enforcementNotes.join(", ")}]`
  };
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

const DEFAULT_MODEL_BY_ROLE: Record<AgentRole, string> = {
  discovery_specialist: "claude-sonnet-4-5",
  plan_synthesis: "claude-sonnet-4-5",
  task_execution: "claude-opus-4-6",
  architecture_specialist: "claude-sonnet-4-5",
  tester: "claude-sonnet-4-5",
  committer: "claude-sonnet-4-5"
};

export class RalphAgentService {
  private readonly modelConfig: ModelConfigMap;

  constructor(modelConfig?: ModelConfigMap) {
    this.modelConfig = modelConfig ?? new Map();
  }

  /**
   * Resolve the model ID for a given agent role.
   * Falls back to opinionated defaults when no DB config exists.
   */
  private getModel(role: AgentRole): string {
    return this.modelConfig.get(role) ?? DEFAULT_MODEL_BY_ROLE[role];
  }

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
    const specialistMaxAttempts = 2;

    const specialistOutcomes = await Promise.all(
      SPECIALIST_JOBS.map(async (job) => {
        let lastError = "Unknown specialist failure.";

        for (let attempt = 1; attempt <= specialistMaxAttempts; attempt += 1) {
          try {
            const result = await this.runSpecialistAnalysis({
              job,
              prompt,
              cwd,
              maxTurns: specialistTurns,
              callbacks,
              attempt,
              maxAttempts: specialistMaxAttempts
            });
            return {
              job,
              report: result.report,
              error: null,
              attemptsUsed: attempt
            };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            callbacks?.onEvent({
              type: "agent",
              level: "error",
              message: `Specialist attempt failed: ${job.id} (${attempt}/${specialistMaxAttempts})`,
              agent: job.id,
              details: lastError
            });
          }
        }

        return {
          job,
          report: null,
          error: lastError,
          attemptsUsed: specialistMaxAttempts
        };
      })
    );

    const completedReports: Array<{ job: SpecialistJob; report: SpecialistAnalysis }> = specialistOutcomes
      .filter((outcome) => outcome.report !== null)
      .map((outcome) => ({ job: outcome.job, report: outcome.report as SpecialistAnalysis }));
    const failedReports = specialistOutcomes.filter((outcome) => outcome.report === null);

    if (completedReports.length === 0) {
      throw new Error("All specialist analyses failed.");
    }

    if (failedReports.length > 0) {
      callbacks?.onEvent({
        type: "status",
        level: "error",
        message:
          `Specialists finished with partial failures: ` +
          `${completedReports.length} succeeded, ${failedReports.length} failed. ` +
          "Synthesizing PRD input with available analyses."
      });
    } else {
      callbacks?.onEvent({
        type: "status",
        level: "info",
        message: `All specialists completed (${completedReports.length}/${SPECIALIST_JOBS.length}). Synthesizing final PRD input...`
      });
    }

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
    const failedSpecialistSummary =
      failedReports.length > 0
        ? failedReports
            .map((failed) => `- ${failed.job.id} (attempts: ${failed.attemptsUsed}): ${failed.error}`)
            .join("\n")
        : "none";

    const synthesisPrompt = `
You are a senior PRD discovery synthesizer.

${prompt}

Specialist outputs (parallel analyses):
${specialistSummary}

Failed specialists after retries:
${failedSpecialistSummary}

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
    let resultText = "";
    let streamedText = "";
    let logBuffer = "";

    for await (const message of query({
      prompt: synthesisPrompt,
      options: {
        ...baseOptions,
        model: this.getModel("discovery_specialist"),
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
        streamedText += textChunk;
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

      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        callbacks?.onEvent({
          type: "status",
          level: "info",
          message: "Structured discovery output received. Validating..."
        });
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput =
          resultMessage.structured_output ??
          tryParseStructuredOutputFromText(resultText) ??
          tryParseStructuredOutputFromText(streamedText);
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
    attempt?: number;
    maxAttempts?: number;
  }): Promise<{ job: SpecialistJob; report: SpecialistAnalysis }> {
    const attempt = input.attempt ?? 1;
    const maxAttempts = input.maxAttempts ?? 1;
    input.callbacks?.onEvent({
      type: "agent",
      level: "info",
      message: `Starting specialist agent: ${input.job.id}`,
      agent: input.job.id,
      details: `${input.job.title} (attempt ${attempt}/${maxAttempts})`
    });

    const specialistPrompt = `
You are specialist agent "${input.job.id}".

${input.prompt}

Specialist objective:
${input.job.objective}

Output requirements:
- Return structured JSON only.
- Do not use markdown fences or commentary outside JSON.
- Required top-level keys: summary, findings, signals, painPoints, constraints, scopeHints, stackHints, documentationHints, questions, confidence.
- Be concrete and evidence-oriented.
- Prefer repository signals when a project path exists.
- Include unresolved questions that materially affect implementation decisions.
`;

    let structuredOutput: unknown;
    let resultText = "";
    let streamedText = "";
    let logBuffer = "";

    for await (const message of query({
      prompt: specialistPrompt,
      options: {
        ...baseOptions,
        model: this.getModel("discovery_specialist"),
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
        streamedText += textChunk;
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

      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput =
          resultMessage.structured_output ??
          tryParseStructuredOutputFromText(resultText) ??
          tryParseStructuredOutputFromText(streamedText);
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

    const parsedReport = specialistAnalysisSchema.parse(structuredOutput);
    const report: SpecialistAnalysis = {
      ...parsedReport,
      confidence: normalizeConfidencePercent(parsedReport.confidence)
    };
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
    let resultText = "";

    for await (const message of query({
      prompt,
      options: {
        ...baseOptions,
        model: this.getModel("plan_synthesis"),
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
      const resultMessage = message as { type?: string; structured_output?: unknown; result?: string };
      if (resultMessage.type === "result") {
        if (typeof resultMessage.result === "string") {
          resultText = resultMessage.result;
        }
        structuredOutput = resultMessage.structured_output ?? tryParseStructuredOutputFromText(resultText);
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

  async runTask(args: RunTaskArgs): Promise<RunTaskResult> {
    const cwd = resolveQueryCwd(args.workingDirectory ?? args.plan.projectPath);
    const taskModel = this.getModel("task_execution");
    const architectureModel = this.getModel("architecture_specialist");
    const testerModel = this.getModel("tester");
    const committerModel = this.getModel("committer");
    const clearResponse = query({
      prompt: "/clear",
      options: {
        ...baseOptions,
        model: taskModel,
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

    let runSessionId: string | null = clearSessionId;
    let totalDurationMs = 0;
    let totalCostUsd = 0;
    let hasCost = false;
    const finalSections: string[] = [];

    const initialHead = await readGitHeadCommit(cwd);
    if (!initialHead) {
      throw new Error("Unable to determine current git HEAD for task execution.");
    }

    const ensureNoCommitYet = async (stageLabel: string): Promise<void> => {
      const currentHead = await readGitHeadCommit(cwd);
      if (currentHead && currentHead !== initialHead) {
        throw new Error(
          `Runtime policy violation: commit detected before committer stage (${stageLabel}).`
        );
      }
    };

    const runStage = async (input: {
      stageName: string;
      prompt: string;
      model: string;
      maxTurns: number;
      outputSchema?: Record<string, unknown>;
      agents?: NonNullable<Options["agents"]>;
    }): Promise<{
      resultText: string;
      stopReason: string | null;
      durationMs: number | null;
      totalCostUsd: number | null;
      structuredOutput?: unknown;
    }> => {
      const agentRole = mapStageToAgentRole(input.stageName);
      args.callbacks.onLog(`\n[stage] ${input.stageName} started\n`);
      args.callbacks.onSubagent({
        kind: "agent_stage",
        stage: input.stageName,
        agentRole,
        status: "started",
        summary: `${input.stageName} started`
      });

      try {
        const options: Options = {
          ...baseOptions,
          model: input.model,
          cwd,
          resume: runSessionId ?? clearSessionId,
          includePartialMessages: true,
          maxTurns: input.maxTurns
        };

        if (input.agents) {
          options.agents = input.agents;
        }

        if (input.outputSchema) {
          options.outputFormat = {
            type: "json_schema",
            schema: input.outputSchema
          };
        }

        const response = query({
          prompt: input.prompt,
          options
        });

        args.callbacks.onQuery(response);

        let resultText = "";
        let stopReason: string | null = null;
        let stageDurationMs: number | null = null;
        let stageCostUsd: number | null = null;
        let structuredOutput: unknown;

        for await (const message of response) {
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
              const toolInput = block.input as { todos?: TodoItem[] } | undefined;
              if (Array.isArray(toolInput?.todos)) {
                args.callbacks.onTodo(toolInput.todos);
              }
            }

            if (block.name === "Task") {
              args.callbacks.onSubagent({
                stage: input.stageName,
                ...(typeof block.input === "object" && block.input ? (block.input as Record<string, unknown>) : {})
              });
            }
          }

          const resultMessage = message as {
            type?: string;
            result?: string;
            stop_reason?: string | null;
            duration_ms?: number;
            total_cost_usd?: number;
            structured_output?: unknown;
          };
          if (resultMessage.type === "result") {
            resultText = resultMessage.result ?? "";
            stopReason = resultMessage.stop_reason ?? null;
            stageDurationMs = resultMessage.duration_ms ?? null;
            stageCostUsd = resultMessage.total_cost_usd ?? null;
            structuredOutput = resultMessage.structured_output;
          }
        }

        totalDurationMs += stageDurationMs ?? 0;
        if (stageCostUsd !== null) {
          totalCostUsd += stageCostUsd;
          hasCost = true;
        }

        if (resultText.trim().length > 0) {
          finalSections.push(`## ${input.stageName}\n${resultText.trim()}`);
        }

        args.callbacks.onLog(`\n[stage] ${input.stageName} completed\n`);
        args.callbacks.onSubagent({
          kind: "agent_stage",
          stage: input.stageName,
          agentRole,
          status: "completed",
          summary: resultText.trim().slice(0, 400),
          stopReason: stopReason ?? undefined
        });

        return {
          resultText,
          stopReason,
          durationMs: stageDurationMs,
          totalCostUsd: stageCostUsd,
          structuredOutput
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        args.callbacks.onSubagent({
          kind: "agent_stage",
          stage: input.stageName,
          agentRole,
          status: "failed",
          summary: message.slice(0, 400)
        });
        throw error;
      }
    };

    const retryInjection = args.retryContext
      ? `\nPrevious attempt failed: ${args.retryContext.previousError}\nRetry attempt: #${args.retryContext.retryCount}\n`
      : "";
    const worktreeInjection = args.branchName
      ? `\nExecution context: cwd=${cwd}, branch=${args.branchName}, phase=${args.phaseNumber ?? "n/a"}\n`
      : "";
    const taskContext = `
Plan summary:
${args.plan.summary}

Task:
- id: ${args.task.id}
- title: ${args.task.title}
- description: ${args.task.description}
- dependencies completed: ${args.task.dependencies.length > 0 ? args.task.dependencies.join(", ") : "none"}

Technical notes:
${args.task.technicalNotes}
`;

    await runStage({
      stageName: "implementation",
      model: taskModel,
      maxTurns: 40,
      agents: {
        "ralph-worker": {
          description:
            "Strict implementation worker for one task. Never run git commit or git merge.",
          prompt: `
You implement only the requested task.
Stay in scope, update code, and prepare for architecture review.
Do NOT run git commit or git merge.
`
        }
      },
      prompt: `
You are running stage: implementation.
${retryInjection}
${worktreeInjection}
${taskContext}

Instructions:
1) Read PRD.md and progress.txt.
2) Implement only this task.
3) Keep code changes scoped and production-safe.
4) Do NOT run git commit or git merge.
5) Return concise changed-files summary.
`
    });
    await ensureNoCommitYet("implementation");

    let architectureReviewIteration = 0;
    let lastArchitectureReview: ArchitectureReview | null = null;

    while (true) {
      architectureReviewIteration += 1;

      const reviewResult = await runStage({
        stageName: `architecture-review-${architectureReviewIteration}`,
        model: architectureModel,
        maxTurns: 16,
        outputSchema: architectureReviewJsonSchema,
        prompt: `
You are running stage: architecture-review.
${taskContext}

Return ONLY valid JSON for this schema.

Review objectives:
- Check if the task changes are in the right service/module.
- Enforce SOLID with strong SRP focus.
- Detect duplicate code and suggest safe DRY refactors.
- Recommend concrete refactor actions when needed.

Status policy:
- pass: zero findings and no actionable quality issue.
- pass_with_notes: only non-critical notes with no required code changes.
- needs_refactor: any structural/code-quality issue that should be fixed before testing.
- blocked: critical issue that prevents safe continuation.

Quality gate rules (strict):
- Any critical finding => blocked.
- Any high finding => needs_refactor or blocked.
- Any medium finding on boundary/srp/duplication/solid => needs_refactor.
- If findings exist, recommendedActions must be concrete and non-empty.
`
      });

      const parsedReview = architectureReviewSchema.parse(reviewResult.structuredOutput);
      const review = enforceArchitectureQualityGate(parsedReview);
      lastArchitectureReview = review;
      args.callbacks.onSubagent({
        kind: "architecture_review",
        iteration: architectureReviewIteration,
        maxIterations: MAX_ARCH_REFACTOR_CYCLES,
        review
      });

      if (review.status === "pass" || review.status === "pass_with_notes") {
        break;
      }

      if (review.status === "blocked") {
        throw new Error(
          `Architecture review blocked execution: ${review.summary}\n${summarizeArchitectureFindings(review)}`
        );
      }

      if (architectureReviewIteration >= MAX_ARCH_REFACTOR_CYCLES) {
        throw new Error(
          `Architecture review still requires refactor after ${MAX_ARCH_REFACTOR_CYCLES} cycle(s): ${review.summary}`
        );
      }

      await runStage({
        stageName: `architecture-refactor-${architectureReviewIteration}`,
        model: taskModel,
        maxTurns: 28,
        agents: {
          "ralph-worker": {
            description:
              "Focused refactor worker for architecture findings. Never run git commit or git merge.",
            prompt: `
Apply only targeted refactors from architecture findings.
Do not widen scope.
Do NOT run git commit or git merge.
`
          }
        },
        prompt: `
You are running stage: architecture-refactor.
${taskContext}

Architecture findings to fix now:
${summarizeArchitectureFindings(review)}

Recommended actions:
${review.recommendedActions.length > 0 ? review.recommendedActions.join("\n") : "- none provided"}

Instructions:
1) Apply only necessary refactors to resolve findings.
2) Preserve task scope and behavior.
3) Do NOT run git commit or git merge.
4) Return concise summary of refactors.
`
      });
      await ensureNoCommitYet(`architecture-refactor-${architectureReviewIteration}`);
    }

    await ensureNoCommitYet("architecture-gate-complete");

    await runStage({
      stageName: "tester",
      model: testerModel,
      maxTurns: 28,
      prompt: `
You are running stage: tester.
${taskContext}

Testing policy (strict):
1) Prefer integration/e2e/system tests in real runtime conditions whenever available.
2) If integration tests are not feasible, run strongest fallback and explain why.
3) Unit tests are fallback-only.
4) Provide commands run and pass/fail evidence.
5) Do NOT run git commit or git merge.
`
    });
    await ensureNoCommitYet("tester");

    const headBeforeCommitter = await readGitHeadCommit(cwd);
    if (!headBeforeCommitter) {
      throw new Error("Unable to determine HEAD before committer stage.");
    }

    const committerResult = await runStage({
      stageName: "committer",
      model: committerModel,
      maxTurns: 24,
      prompt: `
You are running stage: committer.
${taskContext}
${worktreeInjection}

Commit policy (strict):
1) Review current diff and ensure task scope is respected.
2) Create commit(s) using Conventional Commits:
   <type>[optional scope]: <description>
3) Allowed examples: feat, fix, docs, refactor, test, chore, perf, improvement.
4) Never include "Co-authored-by" trailer mentioning Claude.
5) Do NOT run git merge in this stage.
6) Return commit hash(es) and commit message(s).
`
    });

    const headAfterCommitter = await readGitHeadCommit(cwd);
    if (!headAfterCommitter || headAfterCommitter === headBeforeCommitter) {
      throw new Error("Runtime policy violation: committer stage completed without creating a commit.");
    }

    await validateCommitPolicyForRange(
      cwd,
      `${headBeforeCommitter}..${headAfterCommitter}`,
      `task ${args.task.id} committer stage`
    );

    args.callbacks.onSubagent({
      kind: "committer_summary",
      headBefore: headBeforeCommitter,
      headAfter: headAfterCommitter
    });

    if (lastArchitectureReview) {
      finalSections.push(
        `## architecture-gate-summary\nstatus: ${lastArchitectureReview.status}\nsummary: ${lastArchitectureReview.summary}`
      );
    }

    return {
      sessionId: runSessionId,
      resultText: finalSections.join("\n\n"),
      stopReason: committerResult.stopReason,
      durationMs: totalDurationMs > 0 ? totalDurationMs : null,
      totalCostUsd: hasCost ? totalCostUsd : null
    };
  }

  async mergePhaseWithCommitter(args: MergePhaseArgs): Promise<MergePhaseResult> {
    const cwd = resolveQueryCwd(args.repoRoot);
    const committerModel = this.getModel("committer");

    const clearResponse = query({
      prompt: "/clear",
      options: {
        ...baseOptions,
        model: committerModel,
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
      throw new Error("Unable to start a cleared committer session for phase merge.");
    }

    const mergePrompt = `
You are the dedicated Ralph committer agent for queue merge.

Repository root: ${cwd}
Target branch: ${args.targetBranch}
Phase number: ${args.phaseNumber}
Branches to merge in order:
${args.branches.map((branch, index) => `${index + 1}. ${branch}`).join("\n")}

Merge policy (strict):
1) Verify working tree is clean before merging.
2) Checkout the target branch.
3) Merge each branch in listed order using no-fast-forward merge commits.
4) Merge commit messages MUST follow Conventional Commits:
   <type>[optional scope]: <description>
5) Never include any Co-authored-by trailer that mentions Claude.
6) If a conflict occurs, abort the merge and report clearly.
7) Provide a concise summary of merged branches and resulting commit hashes.

You are the only agent allowed to run git merge in this step.
`;

    let sessionId: string | null = clearSessionId;
    let resultText = "";
    let stopReason: string | null = null;

    const mergeResponse = query({
      prompt: mergePrompt,
      options: {
        ...baseOptions,
        model: committerModel,
        cwd,
        resume: clearSessionId,
        includePartialMessages: true,
        maxTurns: 30
      }
    });

    args.callbacks.onQuery(mergeResponse);

    for await (const message of mergeResponse) {
      const textChunk = extractTextDelta(message);
      if (textChunk) {
        args.callbacks.onLog(textChunk);
      }

      const initMessage = message as { type?: string; subtype?: string; session_id?: string };
      if (initMessage.type === "system" && initMessage.subtype === "init" && initMessage.session_id) {
        sessionId = initMessage.session_id;
      }

      const resultMessage = message as {
        type?: string;
        result?: string;
        stop_reason?: string | null;
      };
      if (resultMessage.type === "result") {
        resultText = resultMessage.result ?? "";
        stopReason = resultMessage.stop_reason ?? null;
      }
    }

    return {
      sessionId,
      resultText,
      stopReason
    };
  }
}
