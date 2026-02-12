/**
 * Utility functions shared across the Ralph agent service modules.
 *
 * Includes stream-event parsing helpers, structured-output extraction,
 * git command execution, discovery agent ID management, architecture
 * review helpers, and answer formatting.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { AgentRole, DiscoveryAnswer } from "@shared/types";
import {
  CONVENTIONAL_COMMIT_HEADER,
  CLAUDE_COAUTHOR_TRAILER,
  MAX_DISCOVERY_AGENT_ID_LENGTH
} from "./agent-constants";
import type { ArchitectureReview } from "./agent-schemas";

// ---------------------------------------------------------------------------
// Stream event parsing
// ---------------------------------------------------------------------------

/**
 * Extract the text delta string from a Claude Agent SDK stream event.
 * Returns `null` if the message is not a text_delta event.
 */
export function extractTextDelta(message: unknown): string | null {
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

// ---------------------------------------------------------------------------
// Tool block extraction
// ---------------------------------------------------------------------------

export interface TaskToolInvocation {
  subagentType: string;
  description: string;
  prompt: string;
}

export function extractAssistantToolBlocks(
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

export function parseTaskToolInvocation(input: unknown): TaskToolInvocation | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const subagentTypeRaw = typeof record.subagent_type === "string" ? record.subagent_type.trim() : "";
  const description = typeof record.description === "string" ? record.description : "";
  const prompt = typeof record.prompt === "string" ? record.prompt : "";

  if (subagentTypeRaw.length === 0 && description.trim().length === 0 && prompt.trim().length === 0) {
    return null;
  }

  return {
    subagentType: subagentTypeRaw.length > 0 ? subagentTypeRaw : "unknown",
    description,
    prompt
  };
}

// ---------------------------------------------------------------------------
// Structured output extraction
// ---------------------------------------------------------------------------

/**
 * Attempt to extract a JSON object from arbitrary text produced by a model.
 *
 * Tries, in order:
 * 1. The full trimmed text as JSON.
 * 2. Contents of any ```json fenced blocks.
 * 3. The substring between the first `{` and last `}`.
 * 4. The substring between the first `[` and last `]`.
 */
export function tryParseStructuredOutputFromText(text: string): unknown | null {
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

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a confidence value that may be expressed as 0-1 or 0-100 into
 * an integer percentage clamped to [0, 100].
 */
export function normalizeConfidencePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 1) {
    return Math.max(0, Math.min(100, Math.round(value * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Discovery agent ID management
// ---------------------------------------------------------------------------

export function sanitizeDiscoveryAgentId(raw: string, fallbackOrdinal: number): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const fallback = `analysis-agent-${fallbackOrdinal}`;
  const base = normalized.length > 0 ? normalized : fallback;
  return base.slice(0, MAX_DISCOVERY_AGENT_ID_LENGTH);
}

export function allocateUniqueDiscoveryAgentId(raw: string, fallbackOrdinal: number, used: Set<string>): string {
  const base = sanitizeDiscoveryAgentId(raw, fallbackOrdinal);
  let candidate = base;
  let suffix = 2;

  while (used.has(candidate)) {
    const suffixText = `-${suffix}`;
    const trimmedBase = base.slice(0, Math.max(1, MAX_DISCOVERY_AGENT_ID_LENGTH - suffixText.length));
    candidate = `${trimmedBase}${suffixText}`;
    suffix += 1;
  }

  used.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Bash command extraction
// ---------------------------------------------------------------------------

export function extractBashCommand(toolInput: Record<string, unknown>): string {
  const candidateKeys = ["command", "cmd", "script", "input", "args", "argv"];

  for (const key of candidateKeys) {
    const value = toolInput[key];
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      const joined = value
        .filter((part): part is string => typeof part === "string")
        .join(" ");
      if (joined.trim().length > 0) {
        return joined;
      }
    }
  }

  return JSON.stringify(toolInput);
}

// ---------------------------------------------------------------------------
// Working directory resolution
// ---------------------------------------------------------------------------

export function resolveQueryCwd(projectPath: string): string {
  const normalized = projectPath.trim();
  if (normalized.length > 0 && existsSync(normalized)) {
    return normalized;
  }
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export async function runGitCommand(cwd: string, args: string[]): Promise<string> {
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

export async function readGitHeadCommit(cwd: string): Promise<string | null> {
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

export async function validateCommitPolicyForRange(cwd: string, range: string, context: string): Promise<void> {
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

// ---------------------------------------------------------------------------
// Architecture review helpers
// ---------------------------------------------------------------------------

const ARCHITECTURE_STATUS_RANK: Record<ArchitectureReview["status"], number> = {
  pass: 0,
  pass_with_notes: 1,
  needs_refactor: 2,
  blocked: 3
};

export function summarizeArchitectureFindings(review: ArchitectureReview): string {
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

function mostRestrictiveStatus(
  left: ArchitectureReview["status"],
  right: ArchitectureReview["status"]
): ArchitectureReview["status"] {
  return ARCHITECTURE_STATUS_RANK[left] >= ARCHITECTURE_STATUS_RANK[right] ? left : right;
}

export function enforceArchitectureQualityGate(review: ArchitectureReview): ArchitectureReview {
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

// ---------------------------------------------------------------------------
// Agent role mapping
// ---------------------------------------------------------------------------

export function mapStageToAgentRole(stageName: string): AgentRole {
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

// ---------------------------------------------------------------------------
// Discovery answer formatting
// ---------------------------------------------------------------------------

export function formatAnswers(answers: DiscoveryAnswer[]): string {
  if (answers.length === 0) {
    return "No answers yet.";
  }

  return answers
    .map((item, index) => `${index + 1}. [${item.questionId}] ${item.answer}`)
    .join("\n");
}
