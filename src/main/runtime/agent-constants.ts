/**
 * Constants shared across the Ralph agent service modules.
 *
 * Includes regex patterns for git policy enforcement and discovery heuristics,
 * agent-role-to-model defaults, base SDK options, and static specialist job
 * definitions used during discovery orchestration.
 */

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRole } from "@shared/types";

// ---------------------------------------------------------------------------
// Shared type aliases
// ---------------------------------------------------------------------------

/** Callback signature for resolving an agent role to a model ID. */
export type ModelResolver = (role: AgentRole) => string;

// ---------------------------------------------------------------------------
// Architecture review limits
// ---------------------------------------------------------------------------

export const MAX_ARCH_REFACTOR_CYCLES = 2;

// ---------------------------------------------------------------------------
// Git policy enforcement patterns
// ---------------------------------------------------------------------------

export const CONVENTIONAL_COMMIT_HEADER = /^[a-z]+(?:\([^)]+\))?!?: .+/;
export const CLAUDE_COAUTHOR_TRAILER = /co-authored-by:\s*.*claude/i;
export const MUTATING_GIT_COMMAND_PATTERN =
  /\bgit\s+(?:add|am|apply|branch|checkout|cherry-pick|commit|merge|mv|pull|push|rebase|reset|revert|rm|stash|switch|tag|update-ref|worktree)\b/i;
export const GIT_MERGE_COMMAND_PATTERN = /\bgit\s+merge\b/i;

// ---------------------------------------------------------------------------
// Stack profile storage
// ---------------------------------------------------------------------------

export const STACK_PROFILE_DIR = ".ralph";
export const STACK_PROFILE_FILE = "stack-profile.json";
export const STACK_SPECIALIST_ID = "stack-analyst";

// ---------------------------------------------------------------------------
// Discovery heuristic patterns
// ---------------------------------------------------------------------------

export const STACK_REFRESH_TOKEN_PATTERN = /(?:^|\s)(?:\/refresh-stack|#refresh-stack)\b/i;
export const FULL_DISCOVERY_REFRESH_TOKEN_PATTERN =
  /(?:^|\s)(?:\/refresh-context|#refresh-context|\/refresh-discovery|#refresh-discovery)\b/i;
export const DISCOVERY_CONTEXT_CHANGE_HINT_PATTERN =
  /(?:\b(?:scope|requirement|constraints?|deadline|timeline|security|compliance|architecture|infra(?:structure)?|database|api)\b[\s\S]{0,42}\b(?:change|changed|switch|switched|replace|replaced|new|different|pivot)\b|\b(?:change|changed|switch|switched|replace|replaced|new|different|pivot)\b[\s\S]{0,42}\b(?:scope|requirement|constraints?|deadline|timeline|security|compliance|architecture|infra(?:structure)?|database|api)\b)/i;
export const STACK_CHANGE_HINT_PATTERN =
  /(?:\b(?:stack|framework|language|runtime|database|db|orm)\b[\s\S]{0,42}\b(?:change|changed|switch|switched|migrate|migrated|migration|replace|replaced|rewrite|refactor|move|moved)\b|\b(?:change|changed|switch|switched|migrate|migrated|migration|replace|replaced|rewrite|refactor|move|moved)\b[\s\S]{0,42}\b(?:stack|framework|language|runtime|database|db|orm)\b)/i;

// ---------------------------------------------------------------------------
// Discovery agent limits
// ---------------------------------------------------------------------------

export const MAX_DYNAMIC_DISCOVERY_AGENTS = 6;
export const MIN_DYNAMIC_DISCOVERY_AGENTS = 2;
export const MAX_DISCOVERY_AGENT_ID_LENGTH = 48;

// ---------------------------------------------------------------------------
// Specialist job definitions
// ---------------------------------------------------------------------------

export interface SpecialistJob {
  id: string;
  title: string;
  objective: string;
  producesStackProfile: boolean;
}

export const STACK_SPECIALIST_JOB: SpecialistJob = {
  id: STACK_SPECIALIST_ID,
  title: "Stack analysis",
  objective:
    "Infer the real technology stack, core architecture style, and likely integration points from repository and context.",
  producesStackProfile: true
};

export const FALLBACK_DYNAMIC_DISCOVERY_JOBS: SpecialistJob[] = [
  {
    id: "prd-goal-analyst",
    title: "PRD goal analysis",
    objective:
      "Clarify product objective, success criteria, and ambiguous scope decisions required for a complete pre-PRD draft.",
    producesStackProfile: false
  },
  {
    id: "delivery-risk-analyst",
    title: "Delivery risk analysis",
    objective:
      "Identify implementation blockers, operational constraints, and unresolved decisions that can change technical execution.",
    producesStackProfile: false
  }
];

// ---------------------------------------------------------------------------
// Model defaults per agent role
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL_BY_ROLE: Record<AgentRole, string> = {
  discovery_specialist: "claude-sonnet-4-5",
  plan_synthesis: "claude-sonnet-4-5",
  task_execution: "claude-opus-4-6",
  architecture_specialist: "claude-sonnet-4-5",
  tester: "claude-sonnet-4-5",
  committer: "claude-sonnet-4-5"
};

// ---------------------------------------------------------------------------
// Base Claude Agent SDK options
// ---------------------------------------------------------------------------

export const baseOptions: Pick<Options, "allowDangerouslySkipPermissions" | "permissionMode" | "settingSources"> = {
  allowDangerouslySkipPermissions: true,
  permissionMode: "bypassPermissions" as const,
  settingSources: ["project", "local", "user"]
};
