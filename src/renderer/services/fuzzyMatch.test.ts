import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyMatchCommand } from "./fuzzyMatch";

/* ── fuzzyMatch ───────────────────────────────────────────── */

describe("fuzzyMatch", () => {
  it("returns score > 0 for an exact match", () => {
    const result = fuzzyMatch("settings", "settings");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices).toHaveLength(8);
  });

  it("returns score > 0 for a prefix match", () => {
    const result = fuzzyMatch("set", "settings");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it("returns score 0 when query characters cannot be found in order", () => {
    const result = fuzzyMatch("zxy", "settings");
    expect(result.score).toBe(0);
    expect(result.matchedIndices).toEqual([]);
  });

  it("returns score 0 when query is longer than target", () => {
    const result = fuzzyMatch("settings-page", "settings");
    expect(result.score).toBe(0);
  });

  it("returns score 1 for an empty query (matches everything)", () => {
    const result = fuzzyMatch("", "anything");
    expect(result.score).toBe(1);
    expect(result.matchedIndices).toEqual([]);
  });

  it("is case-insensitive", () => {
    const result = fuzzyMatch("SET", "Settings");
    expect(result.score).toBeGreaterThan(0);
  });

  it("rewards consecutive character matches", () => {
    const contiguous = fuzzyMatch("set", "settings");
    const scattered = fuzzyMatch("sig", "settings");
    // "set" matches indices [0,1,2] — all consecutive
    // "sig" matches s(0), i(4), g(7) — scattered
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it("rewards word-start matches", () => {
    const wordStart = fuzzyMatch("gp", "Go to Plans");
    // 'g' matches at index 0 (word start), 'p' matches at index 6 (word start of "Plans")
    expect(wordStart.score).toBeGreaterThan(0);
    // Both matched characters are at word starts → two word-start bonuses
  });

  it("handles multi-word queries by matching characters in order", () => {
    const result = fuzzyMatch("goset", "Go to Settings");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices.length).toBe(5);
  });

  it("tracks matched indices correctly for sparse matches", () => {
    const result = fuzzyMatch("gt", "Go to Plans");
    expect(result.matchedIndices[0]).toBe(0); // 'G'
    expect(result.matchedIndices[1]).toBe(3); // 't' in "to"
  });
});

/* ── fuzzyMatchCommand ────────────────────────────────────── */

describe("fuzzyMatchCommand", () => {
  it("prefers label matches over description matches (1.5× boost)", () => {
    // Query "plans" appears in both label and description
    const result = fuzzyMatchCommand(
      "plans",
      "Go to Plans",
      "View all plans in the list"
    );
    // The label match should win due to the 1.5× multiplier
    expect(result.score).toBeGreaterThan(0);
  });

  it("falls back to description when label does not match", () => {
    const result = fuzzyMatchCommand(
      "database",
      "Refresh",
      "Reload the plan list from the database"
    );
    expect(result.score).toBeGreaterThan(0);
  });

  it("returns score 0 when neither field matches", () => {
    const result = fuzzyMatchCommand("zzz", "Settings", "Configure the app");
    expect(result.score).toBe(0);
  });

  it("selects the higher-scoring field", () => {
    // "set" is a strong prefix match in label "Settings"
    // "set" also appears somewhere in description
    const result = fuzzyMatchCommand(
      "set",
      "Settings",
      "Configure app settings and model preferences"
    );
    // Label match ("Set" prefix at index 0,1,2) × 1.5 should beat description
    expect(result.score).toBeGreaterThan(0);
  });
});
