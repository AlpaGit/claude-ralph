/**
 * Unit tests for DiscoveryAgent context-change heuristic methods:
 *
 *   - buildCombinedContext (extracted DRY helper)
 *   - shouldRefreshStackAnalysis (stack-change detection)
 *   - shouldForceFullDiscoveryRefresh (full-discovery-refresh detection)
 *
 * These were refactored from two methods that shared an identical 5-line
 * preamble. The helper was extracted and each consumer collapsed to a
 * single boolean expression.
 *
 * Testing approach: bracket-notation access to private methods (same pattern
 * as discovery-agent-format-stack-cache.test.ts), since the public API path
 * requires full Anthropic SDK execution.
 */
import { describe, it, expect } from "vitest";
import type { DiscoveryAnswer } from "@shared/types";
import { DiscoveryAgent } from "../../src/main/runtime/discovery-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stubModelResolver = () => "claude-sonnet-4-20250514";

function createAgent(): DiscoveryAgent {
  return new DiscoveryAgent(stubModelResolver);
}

function answer(text: string): DiscoveryAnswer {
  return { questionId: `q-${Math.random().toString(36).slice(2, 8)}`, answer: text };
}

/** Access private buildCombinedContext via bracket notation. */
function callBuildCombinedContext(
  agent: DiscoveryAgent,
  additionalContext: string,
  latestAnswers: DiscoveryAnswer[]
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (agent as any).buildCombinedContext(additionalContext, latestAnswers);
}

/** Access private shouldRefreshStackAnalysis via bracket notation. */
function callShouldRefreshStackAnalysis(
  agent: DiscoveryAgent,
  additionalContext: string,
  latestAnswers: DiscoveryAnswer[]
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (agent as any).shouldRefreshStackAnalysis(additionalContext, latestAnswers);
}

/** Access private shouldForceFullDiscoveryRefresh via bracket notation. */
function callShouldForceFullDiscoveryRefresh(
  agent: DiscoveryAgent,
  additionalContext: string,
  latestAnswers: DiscoveryAnswer[]
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (agent as any).shouldForceFullDiscoveryRefresh(additionalContext, latestAnswers);
}

// ===========================================================================
// buildCombinedContext
// ===========================================================================

describe("DiscoveryAgent.buildCombinedContext", () => {
  it("returns empty string when both inputs are empty", () => {
    const agent = createAgent();
    expect(callBuildCombinedContext(agent, "", [])).toBe("");
  });

  it("returns empty string when additionalContext is only whitespace", () => {
    const agent = createAgent();
    expect(callBuildCombinedContext(agent, "   \t\n  ", [])).toBe("");
  });

  it("returns empty string when all answers are blank", () => {
    const agent = createAgent();
    expect(callBuildCombinedContext(agent, "", [answer(""), answer("   ")])).toBe("");
  });

  it("returns additionalContext alone when no answers provided", () => {
    const agent = createAgent();
    expect(callBuildCombinedContext(agent, "We use React 19", [])).toBe("We use React 19");
  });

  it("returns answer alone when additionalContext is empty", () => {
    const agent = createAgent();
    expect(callBuildCombinedContext(agent, "", [answer("We switched to Vue")])).toBe(
      "We switched to Vue"
    );
  });

  it("joins non-empty entries with newline", () => {
    const agent = createAgent();
    const result = callBuildCombinedContext(agent, "context line", [
      answer("answer one"),
      answer("answer two")
    ]);
    expect(result).toBe("context line\nanswer one\nanswer two");
  });

  it("filters out blank answers while keeping non-empty ones", () => {
    const agent = createAgent();
    const result = callBuildCombinedContext(agent, "some context", [
      answer(""),
      answer("valid answer"),
      answer("   "),
      answer("another answer")
    ]);
    expect(result).toBe("some context\nvalid answer\nanother answer");
  });

  it("filters out whitespace-only additionalContext while keeping answers", () => {
    const agent = createAgent();
    const result = callBuildCombinedContext(agent, "  ", [answer("only answer")]);
    expect(result).toBe("only answer");
  });
});

// ===========================================================================
// shouldRefreshStackAnalysis
// ===========================================================================

describe("DiscoveryAgent.shouldRefreshStackAnalysis", () => {
  it("returns false when combined context is empty", () => {
    const agent = createAgent();
    expect(callShouldRefreshStackAnalysis(agent, "", [])).toBe(false);
  });

  it("returns false when combined context has no stack-related keywords", () => {
    const agent = createAgent();
    expect(
      callShouldRefreshStackAnalysis(agent, "The color scheme should be blue", [])
    ).toBe(false);
  });

  // STACK_REFRESH_TOKEN_PATTERN: /(?:^|\s)(?:\/refresh-stack|#refresh-stack)\b/i
  it("returns true for /refresh-stack token in additionalContext", () => {
    const agent = createAgent();
    expect(callShouldRefreshStackAnalysis(agent, "/refresh-stack", [])).toBe(true);
  });

  it("returns true for #refresh-stack token in an answer", () => {
    const agent = createAgent();
    expect(
      callShouldRefreshStackAnalysis(agent, "", [answer("#refresh-stack")])
    ).toBe(true);
  });

  it("is case-insensitive for refresh-stack tokens", () => {
    const agent = createAgent();
    expect(callShouldRefreshStackAnalysis(agent, "/REFRESH-STACK", [])).toBe(true);
  });

  // STACK_CHANGE_HINT_PATTERN: bidirectional match of stack/framework/language/etc + change/switch/migrate/etc
  it("returns true when stack-change hint words appear (framework changed)", () => {
    const agent = createAgent();
    expect(
      callShouldRefreshStackAnalysis(agent, "We changed our framework to Next.js", [])
    ).toBe(true);
  });

  it("returns true when stack-change hint words appear (switched database)", () => {
    const agent = createAgent();
    expect(
      callShouldRefreshStackAnalysis(agent, "", [answer("We switched database to PostgreSQL")])
    ).toBe(true);
  });

  it("returns true for reverse word order (migrate the stack)", () => {
    const agent = createAgent();
    expect(
      callShouldRefreshStackAnalysis(agent, "We plan to migrate our stack", [])
    ).toBe(true);
  });

  it("returns false when only one half of the hint pattern is present", () => {
    const agent = createAgent();
    // "framework" without a change verb
    expect(
      callShouldRefreshStackAnalysis(agent, "We use the React framework", [])
    ).toBe(false);
  });
});

// ===========================================================================
// shouldForceFullDiscoveryRefresh
// ===========================================================================

describe("DiscoveryAgent.shouldForceFullDiscoveryRefresh", () => {
  it("returns false when combined context is empty", () => {
    const agent = createAgent();
    expect(callShouldForceFullDiscoveryRefresh(agent, "", [])).toBe(false);
  });

  it("returns false when combined context has no discovery-related keywords", () => {
    const agent = createAgent();
    expect(
      callShouldForceFullDiscoveryRefresh(agent, "Add a blue button to the header", [])
    ).toBe(false);
  });

  // FULL_DISCOVERY_REFRESH_TOKEN_PATTERN: /(?:^|\s)(?:\/refresh-context|#refresh-context|\/refresh-discovery|#refresh-discovery)\b/i
  it("returns true for /refresh-context token", () => {
    const agent = createAgent();
    expect(callShouldForceFullDiscoveryRefresh(agent, "/refresh-context", [])).toBe(true);
  });

  it("returns true for /refresh-discovery token", () => {
    const agent = createAgent();
    expect(callShouldForceFullDiscoveryRefresh(agent, "/refresh-discovery", [])).toBe(true);
  });

  it("returns true for #refresh-context token in an answer", () => {
    const agent = createAgent();
    expect(
      callShouldForceFullDiscoveryRefresh(agent, "", [answer("#refresh-context")])
    ).toBe(true);
  });

  it("is case-insensitive for refresh tokens", () => {
    const agent = createAgent();
    expect(callShouldForceFullDiscoveryRefresh(agent, "/REFRESH-DISCOVERY", [])).toBe(true);
  });

  // DISCOVERY_CONTEXT_CHANGE_HINT_PATTERN: bidirectional match of scope/requirement/constraints/etc + change/switch/new/etc
  it("returns true when discovery-context-change hints appear (scope changed)", () => {
    const agent = createAgent();
    expect(
      callShouldForceFullDiscoveryRefresh(agent, "The scope has changed significantly", [])
    ).toBe(true);
  });

  it("returns true when discovery-context-change hints appear (new requirements)", () => {
    const agent = createAgent();
    expect(
      callShouldForceFullDiscoveryRefresh(agent, "", [
        answer("We have new requirements for security compliance")
      ])
    ).toBe(true);
  });

  it("returns true for reverse word order (different architecture)", () => {
    const agent = createAgent();
    expect(
      callShouldForceFullDiscoveryRefresh(agent, "We picked a different architecture", [])
    ).toBe(true);
  });

  it("returns false when only one half of the hint pattern is present", () => {
    const agent = createAgent();
    // "scope" without a change verb
    expect(
      callShouldForceFullDiscoveryRefresh(agent, "The project scope is large", [])
    ).toBe(false);
  });

  // Cross-method isolation: stack tokens should NOT trigger full discovery refresh
  it("returns false for /refresh-stack token (stack-only, not discovery)", () => {
    const agent = createAgent();
    expect(callShouldForceFullDiscoveryRefresh(agent, "/refresh-stack", [])).toBe(false);
  });
});

// ===========================================================================
// Integration: buildCombinedContext feeds into both heuristics correctly
// ===========================================================================

describe("Context-heuristic integration", () => {
  it("mixed context + answers: stack trigger fires shouldRefreshStackAnalysis but not shouldForceFullDiscoveryRefresh", () => {
    const agent = createAgent();
    const ctx = "Some notes";
    const answers = [answer("We switched our ORM to Drizzle")];

    expect(callShouldRefreshStackAnalysis(agent, ctx, answers)).toBe(true);
    expect(callShouldForceFullDiscoveryRefresh(agent, ctx, answers)).toBe(false);
  });

  it("mixed context + answers: discovery trigger fires shouldForceFullDiscoveryRefresh but not shouldRefreshStackAnalysis", () => {
    const agent = createAgent();
    const ctx = "Some notes";
    const answers = [answer("The scope changed to include mobile apps")];

    expect(callShouldRefreshStackAnalysis(agent, ctx, answers)).toBe(false);
    expect(callShouldForceFullDiscoveryRefresh(agent, ctx, answers)).toBe(true);
  });

  it("blank answers are ignored; only non-blank content is pattern-matched", () => {
    const agent = createAgent();
    // Blank answers that would pass if not filtered:
    // the word "changed" + "scope" would match if the blank strings weren't filtered
    const answers = [answer(""), answer("   "), answer("")];

    expect(callShouldRefreshStackAnalysis(agent, "", answers)).toBe(false);
    expect(callShouldForceFullDiscoveryRefresh(agent, "", answers)).toBe(false);
  });
});
