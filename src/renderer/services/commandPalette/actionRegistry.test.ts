import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerAction,
  registerActions,
  unregisterAction,
  getActions,
  getAction,
  searchActions,
  subscribe,
  resetRegistry,
} from "./actionRegistry";
import type { PaletteAction } from "./types";

/* ── Helpers ──────────────────────────────────────────────── */

function makeAction(overrides: Partial<PaletteAction> = {}): PaletteAction {
  return {
    id: "test-action",
    label: "Test Action",
    description: "A test action",
    category: "Action",
    handler: () => {},
    ...overrides,
  };
}

/* ── Tests ────────────────────────────────────────────────── */

describe("actionRegistry", () => {
  beforeEach(() => {
    resetRegistry();
  });

  /* ── registerAction / getAction / getActions ──────────── */

  describe("registerAction", () => {
    it("adds an action to the registry", () => {
      registerAction(makeAction({ id: "a1" }));
      expect(getActions()).toHaveLength(1);
      expect(getAction("a1")).toBeDefined();
    });

    it("overwrites an existing action with the same id", () => {
      registerAction(makeAction({ id: "a1", label: "First" }));
      registerAction(makeAction({ id: "a1", label: "Second" }));
      expect(getActions()).toHaveLength(1);
      expect(getAction("a1")!.label).toBe("Second");
    });

    it("returns an unregister function", () => {
      const cleanup = registerAction(makeAction({ id: "a1" }));
      expect(getActions()).toHaveLength(1);
      cleanup();
      expect(getActions()).toHaveLength(0);
    });
  });

  /* ── registerActions ────────────────────────────────────── */

  describe("registerActions", () => {
    it("registers multiple actions at once", () => {
      registerActions([
        makeAction({ id: "a1" }),
        makeAction({ id: "a2" }),
        makeAction({ id: "a3" }),
      ]);
      expect(getActions()).toHaveLength(3);
    });

    it("returns a cleanup function that removes all registered actions", () => {
      const cleanup = registerActions([
        makeAction({ id: "a1" }),
        makeAction({ id: "a2" }),
      ]);
      expect(getActions()).toHaveLength(2);
      cleanup();
      expect(getActions()).toHaveLength(0);
    });
  });

  /* ── unregisterAction ───────────────────────────────────── */

  describe("unregisterAction", () => {
    it("removes an action by id", () => {
      registerAction(makeAction({ id: "a1" }));
      unregisterAction("a1");
      expect(getAction("a1")).toBeUndefined();
    });

    it("is a no-op for unknown ids", () => {
      unregisterAction("nonexistent");
      expect(getActions()).toHaveLength(0);
    });
  });

  /* ── subscribe ──────────────────────────────────────────── */

  describe("subscribe", () => {
    it("notifies listeners on register", () => {
      const listener = vi.fn();
      subscribe(listener);
      registerAction(makeAction({ id: "a1" }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("notifies listeners on unregister", () => {
      registerAction(makeAction({ id: "a1" }));
      const listener = vi.fn();
      subscribe(listener);
      unregisterAction("a1");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify after unsubscribe", () => {
      const listener = vi.fn();
      const unsub = subscribe(listener);
      unsub();
      registerAction(makeAction({ id: "a1" }));
      expect(listener).not.toHaveBeenCalled();
    });

    it("does not notify when unregistering an unknown id", () => {
      const listener = vi.fn();
      subscribe(listener);
      unregisterAction("nonexistent");
      expect(listener).not.toHaveBeenCalled();
    });
  });

  /* ── searchActions ──────────────────────────────────────── */

  describe("searchActions", () => {
    beforeEach(() => {
      registerActions([
        makeAction({
          id: "nav:settings",
          label: "Go to Settings",
          description: "Configure app settings",
          category: "Navigation",
        }),
        makeAction({
          id: "nav:plans",
          label: "Go to Plans",
          description: "View all plans",
          category: "Navigation",
        }),
        makeAction({
          id: "action:new-plan",
          label: "New Plan",
          description: "Start a new plan via discovery",
          category: "Action",
        }),
        makeAction({
          id: "shortcut:focus-search",
          label: "Focus Search",
          description: "Focus the plan search input",
          category: "Shortcut",
          shortcut: "Ctrl+F",
        }),
      ]);
    });

    it("returns all actions sorted by category then label when query is empty", () => {
      const results = searchActions("");
      expect(results).toHaveLength(4);
      // Action < Navigation < Shortcut (alphabetical)
      expect(results[0].action.category).toBe("Action");
      expect(results[1].action.category).toBe("Navigation");
      expect(results[2].action.category).toBe("Navigation");
      expect(results[3].action.category).toBe("Shortcut");
    });

    it("returns all actions for whitespace-only query", () => {
      const results = searchActions("   ");
      expect(results).toHaveLength(4);
    });

    it("filters by fuzzy match", () => {
      const results = searchActions("settings");
      // Should match "Go to Settings" and "Configure app settings"
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].action.id).toBe("nav:settings");
    });

    it("excludes non-matching actions", () => {
      const results = searchActions("zzzzz");
      expect(results).toHaveLength(0);
    });

    it("sorts results by score descending", () => {
      const results = searchActions("plan");
      // "New Plan" has "plan" in the label → strong match
      // "Go to Plans" also matches
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("returns match score and indices for each result", () => {
      const results = searchActions("new");
      expect(results.length).toBeGreaterThanOrEqual(1);
      const first = results[0];
      expect(first.score).toBeGreaterThan(0);
      // matchedIndices is an array of numbers
      expect(Array.isArray(first.matchedIndices)).toBe(true);
    });
  });

  /* ── resetRegistry ──────────────────────────────────────── */

  describe("resetRegistry", () => {
    it("clears all actions and listeners", () => {
      const listener = vi.fn();
      subscribe(listener);
      registerAction(makeAction({ id: "a1" }));
      listener.mockClear();

      resetRegistry();
      expect(getActions()).toHaveLength(0);

      // Listener was cleared, so this registration should not trigger it
      registerAction(makeAction({ id: "a2" }));
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
