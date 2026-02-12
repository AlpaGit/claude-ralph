/**
 * Discovery-domain prompt templates.
 *
 * Covers the full discovery lifecycle: stack refresh, start, continue,
 * orchestrator planning, specialist analysis, synthesis, and stack inference.
 */

import type { PromptTemplate } from "./prompt-builder";
import {
  discoveryContinueParamsSchema,
  discoveryOrchestratorParamsSchema,
  discoveryStartParamsSchema,
  discoverySynthesisParamsSchema,
  inferStackExistingParamsSchema,
  inferStackNewParamsSchema,
  specialistAnalysisParamsSchema,
  stackRefreshParamsSchema
} from "./prompt-schemas";

// ---------------------------------------------------------------------------
// stack-refresh
// ---------------------------------------------------------------------------

export const stackRefreshTemplate: PromptTemplate<typeof stackRefreshParamsSchema> = {
  description: "Analyze the current codebase stack and produce a refresh summary for planning continuity.",
  schema: stackRefreshParamsSchema,
  render: (p) => `
Stack profile refresh request.

Project path:
${p.normalizedPath}

Additional context:
${p.additionalContext || "none"}

Goal:
- Analyze the current codebase stack as it exists now.
- Detect stack signals from repository artifacts.
- Produce a precise summary for future planning continuity.
`
};

// ---------------------------------------------------------------------------
// discovery-start
// ---------------------------------------------------------------------------

export const discoveryStartTemplate: PromptTemplate<typeof discoveryStartParamsSchema> = {
  description: "Initial discovery prompt to convert a user seed sentence into a precise execution-ready PRD input.",
  schema: discoveryStartParamsSchema,
  render: (p) => `
Discovery context for PRD interview:

User seed sentence:
${p.seedSentence}

Additional user context:
${p.additionalContext || "none"}

Project path:
${p.projectPath || "(not provided)"}
Project mode:
${p.hasProjectPath ? "existing codebase" : "new/unspecified project"}

Phase:
- Initial discovery

Goal:
- Turn this short request into a precise execution-ready PRD input.
- Ask many high-impact clarification questions and remove ambiguity.
`
};

// ---------------------------------------------------------------------------
// discovery-continue
// ---------------------------------------------------------------------------

export const discoveryContinueTemplate: PromptTemplate<typeof discoveryContinueParamsSchema> = {
  description: "Continuation discovery prompt to refine PRD direction with follow-up answers.",
  schema: discoveryContinueParamsSchema,
  render: (p) => `
Discovery continuation context for PRD interview:

Original seed sentence:
${p.seedSentence}

Additional user context:
${p.additionalContext || "none"}

Project path:
${p.projectPath || "(not provided)"}

All answers so far:
${p.formattedAnswerHistory}

Latest answers:
${p.formattedLatestAnswers}

Phase:
- Continue discovery with follow-up answers

Goal:
- Refine PRD direction with the new answers.
- Ask only unresolved high-impact follow-up questions.
- Produce an increasingly decision-complete PRD input draft.
`
};

// ---------------------------------------------------------------------------
// discovery-orchestrator
// ---------------------------------------------------------------------------

export const discoveryOrchestratorTemplate: PromptTemplate<typeof discoveryOrchestratorParamsSchema> = {
  description: "Master orchestrator prompt to plan which dynamic analysis agents are needed for a discovery round.",
  schema: discoveryOrchestratorParamsSchema,
  render: (p) => `
You are the master discovery orchestrator for Ralph mode.

Objective:
- Decide which analysis agents are required for this round to reach a complete pre-PRD.
- This step plans agents only. Do not run analyses yourself.

Discovery context:
${p.discoveryContext}

Project path:
${p.projectPath || "(not provided)"}
Project mode:
${p.hasProjectPath ? "existing codebase" : "new/unspecified project"}

Cached project memory / stack profile (use as default truth when available):
${p.stackCacheSummary}

Stack refresh required this round:
${p.includeStackSpecialist ? "yes" : "no"}

Planning rules:
1) Define a dynamic set of analysis agents based on this request. Do NOT rely on a fixed preset list.
2) Choose the smallest set that can still complete a high-quality pre-PRD in this round.
3) Jobs must be parallelizable and non-overlapping.
4) Return between ${p.minAgents} and ${p.maxAgents} jobs unless context is trivial.
5) id must be short kebab-case and unique.
6) objective must be concrete and evidence-oriented.
7) If stack refresh required is "yes", exactly one job must set producesStackProfile=true.
8) If stack refresh required is "no", set producesStackProfile=false for all jobs and rely on cached stack where present.
`
};

// ---------------------------------------------------------------------------
// discovery-synthesis
// ---------------------------------------------------------------------------

export const discoverySynthesisTemplate: PromptTemplate<typeof discoverySynthesisParamsSchema> = {
  description: "Merge parallel specialist analysis findings into a coherent PRD direction with clarification questions.",
  schema: discoverySynthesisParamsSchema,
  render: (p) => `
You are a senior PRD discovery synthesizer.

${p.discoveryContext}

Dynamic analysis outputs (parallel):
${p.specialistSummary}

Failed analyses after retries:
${p.failedSpecialistSummary}

Synthesis requirements:
1) Merge analysis findings into one coherent direction summary.
2) Build inferredContext with practical stack/docs/scope/pain/constraints/signals.
3) Produce EXACTLY 3 high-impact clarification questions per round:
   - Every question MUST have question_type set to "multiple_choice".
   - Every question MUST have an "options" array with 4 to 5 distinct, actionable choices.
   - Every question MUST have a "recommendedOption" string that matches one of the options values exactly.
   - Every question MUST have a "selectionMode" of either "single" or "multi" depending on whether the user should pick one answer or can pick several.
   - Questions should be ordered by impact: most critical uncertainty first.
   - Do NOT produce text-only questions; all questions must be multiple-choice with concrete options.
   - Always return exactly 3 questions, even during continuation rounds with strong readiness.
4) Generate a polished prdInputDraft ready for plan generation.
5) readinessScore must reflect real confidence.
6) missingCriticalInfo must list blockers that can still change implementation decisions.
7) If any analysis failed, explicitly reflect uncertainty in missingCriticalInfo.
8) If stack-cache is present, treat it as the default stack truth unless new evidence contradicts it.
`
};

// ---------------------------------------------------------------------------
// specialist-analysis
// ---------------------------------------------------------------------------

export const specialistAnalysisTemplate: PromptTemplate<typeof specialistAnalysisParamsSchema> = {
  description: "Prompt for a specialist discovery agent to analyze one specific aspect of the project.",
  schema: specialistAnalysisParamsSchema,
  render: (p) => `
You are specialist agent "${p.jobId}".

${p.discoveryContext}

Specialist objective:
${p.objective}

Output requirements:
- Return structured JSON only.
- Do not use markdown fences or commentary outside JSON.
- Required top-level keys: summary, findings, signals, painPoints, constraints, scopeHints, stackHints, documentationHints, questions, confidence.
- Be concrete and evidence-oriented.
- Prefer repository signals when a project path exists.
- Include unresolved questions that materially affect implementation decisions.
`
};

// ---------------------------------------------------------------------------
// infer-stack-existing
// ---------------------------------------------------------------------------

export const inferStackExistingTemplate: PromptTemplate<typeof inferStackExistingParamsSchema> = {
  description: "Infer the real technology stack from an existing codebase and recommend the best stack summary.",
  schema: inferStackExistingParamsSchema,
  render: (p) => `
You are a software architecture analyst.

Task: infer the real technology stack from this existing codebase and recommend the best stack summary for PRD planning.

Inputs:
- projectPath: ${p.normalizedPath || "(not provided)"}
- projectGoal: ${p.projectGoal}
- constraints: ${p.constraints || "none"}
- currentStackHint: ${p.currentStack || "none"}

Instructions:
1) Inspect repository signals (configs, manifests, lockfiles, src structure) before concluding.
2) Return one recommendedStack string suitable for a PRD.
3) Include detectedSignals that justify your conclusion.
4) Provide alternatives only if uncertainty exists.
5) Include follow-up questions when critical info is missing.
6) Use the "stack-architect" subagent via Task for focused analysis.
`
};

// ---------------------------------------------------------------------------
// infer-stack-new
// ---------------------------------------------------------------------------

export const inferStackNewTemplate: PromptTemplate<typeof inferStackNewParamsSchema> = {
  description: "Suggest the most suitable initial stack for a new project based on product intent.",
  schema: inferStackNewParamsSchema,
  render: (p) => `
You are a software architecture advisor for a new project.

Task: suggest the most suitable initial stack based on product intent and constraints.

Inputs:
- projectGoal: ${p.projectGoal}
- constraints: ${p.constraints || "none"}
- currentStackHint: ${p.currentStack || "none"}

Instructions:
1) Recommend one default stack with practical rationale.
2) Provide 2-3 alternatives with tradeoffs.
3) Ask high-impact follow-up questions to clarify needs/wants.
4) Include confidence score.
5) Use the "stack-architect" subagent via Task for focused reasoning.
`
};
