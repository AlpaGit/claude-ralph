/**
 * Unit tests for DiscoveryAgent.formatStackCacheSummary
 *
 * Validates the extracted private helper that formats a StackProfileCache into
 * a `### stack-cache` markdown block with pretty-printed JSON matching the
 * specialist-analysis shape.
 *
 * This helper was extracted from two verbatim duplicate blocks in
 * runDiscoveryPrompt (carry-forward path and fresh-analysis path).
 */
import { describe, it, expect } from "vitest";
import { DiscoveryAgent, type StackProfileCache } from "../../src/main/runtime/discovery-agent";

// Minimal ModelResolver stub — formatStackCacheSummary never calls it.
const stubModelResolver = () => "claude-sonnet-4-20250514";

function createAgent(): DiscoveryAgent {
  return new DiscoveryAgent(stubModelResolver);
}

function makeCache(overrides: Partial<StackProfileCache> = {}): StackProfileCache {
  return {
    version: 1,
    updatedAt: "2026-02-12T20:00:00.000Z",
    specialistId: "stack-analyst" as const,
    stackSummary: "React 19 + Electron 40 + better-sqlite3",
    stackHints: ["electron", "react", "sqlite"],
    signals: ["package.json found", "tsconfig.json found"],
    confidence: 0.85,
    ...overrides
  };
}

/**
 * Access the private method via bracket notation.
 * This is the standard approach for testing extracted private helpers
 * when the public API path requires full agent execution (Anthropic SDK calls).
 */
function callFormatStackCacheSummary(agent: DiscoveryAgent, cache: StackProfileCache): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (agent as any).formatStackCacheSummary(cache);
}

describe("DiscoveryAgent.formatStackCacheSummary", () => {
  it("returns a string starting with the ### stack-cache header", () => {
    const agent = createAgent();
    const result = callFormatStackCacheSummary(agent, makeCache());

    expect(result).toMatch(/^### stack-cache\n/);
  });

  it("produces valid JSON after the header line", () => {
    const agent = createAgent();
    const result = callFormatStackCacheSummary(agent, makeCache());

    const jsonPart = result.replace(/^### stack-cache\n/, "");
    expect(() => JSON.parse(jsonPart)).not.toThrow();
  });

  it("maps stackSummary to summary field", () => {
    const agent = createAgent();
    const cache = makeCache({ stackSummary: "Next.js 15 fullstack monorepo" });
    const result = callFormatStackCacheSummary(agent, cache);

    const parsed = JSON.parse(result.replace(/^### stack-cache\n/, ""));
    expect(parsed.summary).toBe("Next.js 15 fullstack monorepo");
  });

  it("passes through signals array from cache", () => {
    const agent = createAgent();
    const cache = makeCache({ signals: ["docker-compose.yml", "Makefile"] });
    const result = callFormatStackCacheSummary(agent, cache);

    const parsed = JSON.parse(result.replace(/^### stack-cache\n/, ""));
    expect(parsed.signals).toEqual(["docker-compose.yml", "Makefile"]);
  });

  it("passes through stackHints array from cache", () => {
    const agent = createAgent();
    const cache = makeCache({ stackHints: ["vue", "vite", "pinia"] });
    const result = callFormatStackCacheSummary(agent, cache);

    const parsed = JSON.parse(result.replace(/^### stack-cache\n/, ""));
    expect(parsed.stackHints).toEqual(["vue", "vite", "pinia"]);
  });

  it("passes through confidence value from cache", () => {
    const agent = createAgent();
    const cache = makeCache({ confidence: 0.42 });
    const result = callFormatStackCacheSummary(agent, cache);

    const parsed = JSON.parse(result.replace(/^### stack-cache\n/, ""));
    expect(parsed.confidence).toBe(0.42);
  });

  it("fills specialist-analysis padding arrays with empty arrays", () => {
    const agent = createAgent();
    const result = callFormatStackCacheSummary(agent, makeCache());

    const parsed = JSON.parse(result.replace(/^### stack-cache\n/, ""));
    expect(parsed.findings).toEqual([]);
    expect(parsed.painPoints).toEqual([]);
    expect(parsed.constraints).toEqual([]);
    expect(parsed.scopeHints).toEqual([]);
    expect(parsed.documentationHints).toEqual([]);
    expect(parsed.questions).toEqual([]);
  });

  it("produces pretty-printed JSON with 2-space indentation", () => {
    const agent = createAgent();
    const result = callFormatStackCacheSummary(agent, makeCache());
    const jsonPart = result.replace(/^### stack-cache\n/, "");

    // Verify indentation: second line should start with 2 spaces
    const lines = jsonPart.split("\n");
    expect(lines[0]).toBe("{");
    expect(lines[1]).toMatch(/^ {2}"/);
  });

  it("contains exactly the expected keys in the JSON object", () => {
    const agent = createAgent();
    const result = callFormatStackCacheSummary(agent, makeCache());
    const parsed = JSON.parse(result.replace(/^### stack-cache\n/, ""));

    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual([
      "confidence",
      "constraints",
      "documentationHints",
      "findings",
      "painPoints",
      "questions",
      "scopeHints",
      "signals",
      "stackHints",
      "summary"
    ]);
  });

  it("handles empty arrays in cache gracefully", () => {
    const agent = createAgent();
    const cache = makeCache({ signals: [], stackHints: [] });
    const result = callFormatStackCacheSummary(agent, cache);

    const parsed = JSON.parse(result.replace(/^### stack-cache\n/, ""));
    expect(parsed.signals).toEqual([]);
    expect(parsed.stackHints).toEqual([]);
  });

  it("does not include StackProfileCache metadata fields (version, updatedAt, specialistId)", () => {
    const agent = createAgent();
    const result = callFormatStackCacheSummary(agent, makeCache());
    const parsed = JSON.parse(result.replace(/^### stack-cache\n/, ""));

    expect(parsed).not.toHaveProperty("version");
    expect(parsed).not.toHaveProperty("updatedAt");
    expect(parsed).not.toHaveProperty("specialistId");
  });
});
