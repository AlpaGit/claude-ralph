// @vitest-environment jsdom

/**
 * Unit tests for planStore (Zustand store).
 *
 * Tests cover:
 * - loadPlanList populates state
 * - createPlan calls API and updates state
 * - deletePlan removes from list
 * - archivePlan / unarchivePlan toggle state
 * - loadPlan loads a single plan into currentPlan
 * - clearError resets error state
 * - Error handling for all async actions
 *
 * All tests mock window.ralphApi via installMockRalphApi and reset store
 * state between tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { installMockRalphApi, type MockRalphApi } from "../../../src/test-utils/mock-ralph-api";

// Mock the toastService to avoid react-hot-toast DOM operations in jsdom
vi.mock("../../../src/renderer/services/toastService", () => ({
  toastService: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Must import the store AFTER mocking toastService and installing the API
import { usePlanStore, type PlanSummary } from "../../../src/renderer/stores/planStore";
import type { PlanListItem, RalphPlan, TechnicalPack } from "@shared/types";

// ── Helpers ──────────────────────────────────────────────

function makeTechnicalPack(overrides?: Partial<TechnicalPack>): TechnicalPack {
  return {
    summary: "Test tech pack summary",
    architecture_notes: [],
    files_expected: [],
    dependencies: [],
    risks: [],
    assumptions: [],
    acceptance_criteria: [],
    test_strategy: [],
    effort_estimate: "1 day",
    checklist: [],
    ...overrides,
  };
}

function makePlan(overrides?: Partial<RalphPlan>): RalphPlan {
  return {
    id: "plan-001",
    projectPath: "/test/project",
    prdText: "This is a test PRD with sufficient length for validation.",
    summary: "Test plan summary",
    technicalPack: makeTechnicalPack(),
    status: "ready",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    archivedAt: null,
    tasks: [],
    runs: [],
    ...overrides,
  };
}

function makePlanListItem(overrides?: Partial<PlanListItem>): PlanListItem {
  return {
    id: "plan-001",
    summary: "Test plan summary",
    status: "ready",
    projectPath: "/test/project",
    createdAt: "2025-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

/** Initial (clean) state for the planStore. */
const initialState = {
  currentPlan: null,
  plansList: [],
  loadingPlan: false,
  loadingList: false,
  creating: false,
  error: null,
  lastIpcError: null,
};

describe("planStore", () => {
  let api: MockRalphApi;

  beforeEach(() => {
    api = installMockRalphApi();
    // Reset store state to initial between tests
    usePlanStore.setState(initialState);
  });

  // ── loadPlanList ─────────────────────────────────────

  describe("loadPlanList", () => {
    it("should populate plansList with items from the API", async () => {
      const items: PlanListItem[] = [
        makePlanListItem({ id: "p1", summary: "Plan One" }),
        makePlanListItem({ id: "p2", summary: "Plan Two" }),
        makePlanListItem({ id: "p3", summary: "Plan Three" }),
      ];
      api.listPlans.mockResolvedValue(items);

      await usePlanStore.getState().loadPlanList();

      const state = usePlanStore.getState();
      expect(state.plansList).toHaveLength(3);
      expect(state.plansList[0].id).toBe("p1");
      expect(state.plansList[1].id).toBe("p2");
      expect(state.plansList[2].id).toBe("p3");
      expect(state.loadingList).toBe(false);
      expect(state.error).toBeNull();
    });

    it("should set loadingList to true during fetch and false after", async () => {
      let resolvePromise: (value: PlanListItem[]) => void;
      const pendingPromise = new Promise<PlanListItem[]>((resolve) => {
        resolvePromise = resolve;
      });
      api.listPlans.mockReturnValue(pendingPromise);

      const fetchPromise = usePlanStore.getState().loadPlanList();
      expect(usePlanStore.getState().loadingList).toBe(true);

      resolvePromise!([]);
      await fetchPromise;

      expect(usePlanStore.getState().loadingList).toBe(false);
    });

    it("should pass filter to the API", async () => {
      api.listPlans.mockResolvedValue([]);

      await usePlanStore.getState().loadPlanList({ archived: true, search: "test" });

      expect(api.listPlans).toHaveBeenCalledWith({
        filter: { archived: true, search: "test" },
      });
    });

    it("should set error on API failure", async () => {
      api.listPlans.mockRejectedValue(new Error("Network error"));

      await usePlanStore.getState().loadPlanList();

      const state = usePlanStore.getState();
      expect(state.error).toBe("Network error");
      expect(state.plansList).toEqual([]);
      expect(state.loadingList).toBe(false);
    });

    it("should clear previous error before fetching", async () => {
      usePlanStore.setState({ error: "old error" });
      api.listPlans.mockResolvedValue([]);

      await usePlanStore.getState().loadPlanList();

      expect(usePlanStore.getState().error).toBeNull();
    });

    it("should handle empty list from API", async () => {
      api.listPlans.mockResolvedValue([]);

      await usePlanStore.getState().loadPlanList();

      expect(usePlanStore.getState().plansList).toEqual([]);
    });

    it("should map PlanListItem fields to PlanSummary fields", async () => {
      const item = makePlanListItem({
        id: "p-mapped",
        summary: "Mapped plan",
        status: "draft",
        projectPath: "/mapped/path",
        createdAt: "2025-06-15T12:00:00.000Z",
        archivedAt: "2025-06-16T12:00:00.000Z",
      });
      api.listPlans.mockResolvedValue([item]);

      await usePlanStore.getState().loadPlanList();

      const summary = usePlanStore.getState().plansList[0];
      expect(summary.id).toBe("p-mapped");
      expect(summary.summary).toBe("Mapped plan");
      expect(summary.status).toBe("draft");
      expect(summary.projectPath).toBe("/mapped/path");
      expect(summary.createdAt).toBe("2025-06-15T12:00:00.000Z");
      expect(summary.archivedAt).toBe("2025-06-16T12:00:00.000Z");
    });
  });

  // ── createPlan ───────────────────────────────────────

  describe("createPlan", () => {
    it("should call API with prdText and projectPath and return planId", async () => {
      const planId = "new-plan-id";
      api.createPlan.mockResolvedValue({ planId });
      api.getPlan.mockResolvedValue(makePlan({ id: planId }));

      const result = await usePlanStore.getState().createPlan(
        "This is a test PRD with enough text.",
        "/some/project"
      );

      expect(result).toBe(planId);
      expect(api.createPlan).toHaveBeenCalledWith({
        prdText: "This is a test PRD with enough text.",
        projectPath: "/some/project",
      });
    });

    it("should auto-load the created plan into currentPlan", async () => {
      const planId = "new-plan-id";
      const plan = makePlan({ id: planId, summary: "Newly created" });
      api.createPlan.mockResolvedValue({ planId });
      api.getPlan.mockResolvedValue(plan);

      await usePlanStore.getState().createPlan("PRD text sufficient length.", "/path");

      expect(api.getPlan).toHaveBeenCalledWith(planId);
      expect(usePlanStore.getState().currentPlan?.id).toBe(planId);
      expect(usePlanStore.getState().currentPlan?.summary).toBe("Newly created");
    });

    it("should set creating to true during creation and false after", async () => {
      let resolvePromise: (value: { planId: string }) => void;
      const pendingPromise = new Promise<{ planId: string }>((resolve) => {
        resolvePromise = resolve;
      });
      api.createPlan.mockReturnValue(pendingPromise);

      const createPromise = usePlanStore.getState().createPlan("PRD text.", "/path");
      expect(usePlanStore.getState().creating).toBe(true);

      // Resolve createPlan but also mock getPlan for the auto-load
      api.getPlan.mockResolvedValue(makePlan());
      resolvePromise!({ planId: "p1" });
      await createPromise;

      expect(usePlanStore.getState().creating).toBe(false);
    });

    it("should set error and re-throw on API failure", async () => {
      api.createPlan.mockRejectedValue(new Error("Creation failed"));

      await expect(
        usePlanStore.getState().createPlan("PRD text.", "/path")
      ).rejects.toThrow("Creation failed");

      const state = usePlanStore.getState();
      expect(state.error).toBe("Creation failed");
      expect(state.creating).toBe(false);
    });

    it("should add the created plan to plansList", async () => {
      const planId = "plan-for-list";
      const plan = makePlan({ id: planId, summary: "Added to list" });
      api.createPlan.mockResolvedValue({ planId });
      api.getPlan.mockResolvedValue(plan);

      await usePlanStore.getState().createPlan("PRD text.", "/path");

      const plansList = usePlanStore.getState().plansList;
      expect(plansList.length).toBeGreaterThanOrEqual(1);
      expect(plansList.find((p) => p.id === planId)).toBeDefined();
    });
  });

  // ── loadPlan ─────────────────────────────────────────

  describe("loadPlan", () => {
    it("should set currentPlan from API response", async () => {
      const plan = makePlan({ id: "load-me", summary: "Loaded plan" });
      api.getPlan.mockResolvedValue(plan);

      await usePlanStore.getState().loadPlan("load-me");

      expect(usePlanStore.getState().currentPlan?.id).toBe("load-me");
      expect(usePlanStore.getState().currentPlan?.summary).toBe("Loaded plan");
    });

    it("should set loadingPlan to true during fetch and false after", async () => {
      let resolvePromise: (value: RalphPlan | null) => void;
      const pendingPromise = new Promise<RalphPlan | null>((resolve) => {
        resolvePromise = resolve;
      });
      api.getPlan.mockReturnValue(pendingPromise);

      const loadPromise = usePlanStore.getState().loadPlan("p1");
      expect(usePlanStore.getState().loadingPlan).toBe(true);

      resolvePromise!(null);
      await loadPromise;

      expect(usePlanStore.getState().loadingPlan).toBe(false);
    });

    it("should add loaded plan to plansList if not present", async () => {
      const plan = makePlan({ id: "new-entry", summary: "New entry" });
      api.getPlan.mockResolvedValue(plan);

      await usePlanStore.getState().loadPlan("new-entry");

      const plansList = usePlanStore.getState().plansList;
      expect(plansList).toHaveLength(1);
      expect(plansList[0].id).toBe("new-entry");
    });

    it("should update existing entry in plansList", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "existing", summary: "Old summary", status: "draft", projectPath: "/old", createdAt: "2025-01-01T00:00:00.000Z" },
        ],
      });
      const plan = makePlan({ id: "existing", summary: "Updated summary", status: "ready" });
      api.getPlan.mockResolvedValue(plan);

      await usePlanStore.getState().loadPlan("existing");

      const plansList = usePlanStore.getState().plansList;
      expect(plansList).toHaveLength(1);
      expect(plansList[0].summary).toBe("Updated summary");
      expect(plansList[0].status).toBe("ready");
    });

    it("should set error on API failure", async () => {
      api.getPlan.mockRejectedValue(new Error("Plan not found"));

      await usePlanStore.getState().loadPlan("bad-id");

      expect(usePlanStore.getState().error).toBe("Plan not found");
      expect(usePlanStore.getState().loadingPlan).toBe(false);
    });

    it("should handle null plan response without error", async () => {
      api.getPlan.mockResolvedValue(null);

      await usePlanStore.getState().loadPlan("nonexistent");

      expect(usePlanStore.getState().currentPlan).toBeNull();
      expect(usePlanStore.getState().error).toBeNull();
    });
  });

  // ── deletePlan ───────────────────────────────────────

  describe("deletePlan", () => {
    it("should call API and remove plan from plansList", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "keep", summary: "Keep me", status: "ready", projectPath: "/keep", createdAt: "2025-01-01T00:00:00.000Z" },
          { id: "delete-me", summary: "Delete me", status: "draft", projectPath: "/delete", createdAt: "2025-01-01T00:00:00.000Z" },
        ],
      });
      api.deletePlan.mockResolvedValue(undefined);

      await usePlanStore.getState().deletePlan("delete-me");

      expect(api.deletePlan).toHaveBeenCalledWith({ planId: "delete-me" });
      const plansList = usePlanStore.getState().plansList;
      expect(plansList).toHaveLength(1);
      expect(plansList[0].id).toBe("keep");
    });

    it("should clear currentPlan if the deleted plan is currently selected", async () => {
      const plan = makePlan({ id: "active-plan" });
      usePlanStore.setState({
        currentPlan: plan,
        plansList: [{ id: "active-plan", summary: "Active", status: "ready", projectPath: "/p", createdAt: "2025-01-01T00:00:00.000Z" }],
      });
      api.deletePlan.mockResolvedValue(undefined);

      await usePlanStore.getState().deletePlan("active-plan");

      expect(usePlanStore.getState().currentPlan).toBeNull();
      expect(usePlanStore.getState().plansList).toHaveLength(0);
    });

    it("should not clear currentPlan if a different plan is deleted", async () => {
      const currentPlan = makePlan({ id: "current" });
      usePlanStore.setState({
        currentPlan,
        plansList: [
          { id: "current", summary: "Current", status: "ready", projectPath: "/c", createdAt: "2025-01-01T00:00:00.000Z" },
          { id: "other", summary: "Other", status: "draft", projectPath: "/o", createdAt: "2025-01-01T00:00:00.000Z" },
        ],
      });
      api.deletePlan.mockResolvedValue(undefined);

      await usePlanStore.getState().deletePlan("other");

      expect(usePlanStore.getState().currentPlan?.id).toBe("current");
    });

    it("should set error on API failure without removing from list", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "fail-plan", summary: "Fail", status: "ready", projectPath: "/f", createdAt: "2025-01-01T00:00:00.000Z" },
        ],
      });
      api.deletePlan.mockRejectedValue(new Error("Delete failed"));

      await usePlanStore.getState().deletePlan("fail-plan");

      expect(usePlanStore.getState().error).toBe("Delete failed");
      expect(usePlanStore.getState().plansList).toHaveLength(1);
    });

    it("should handle deleting from empty list gracefully", async () => {
      api.deletePlan.mockResolvedValue(undefined);

      await usePlanStore.getState().deletePlan("nonexistent");

      expect(usePlanStore.getState().plansList).toHaveLength(0);
      expect(usePlanStore.getState().error).toBeNull();
    });
  });

  // ── archivePlan ──────────────────────────────────────

  describe("archivePlan", () => {
    it("should call API and set archivedAt in plansList", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "archive-me", summary: "Archive", status: "ready", projectPath: "/a", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
        ],
      });
      api.archivePlan.mockResolvedValue(undefined);

      await usePlanStore.getState().archivePlan("archive-me");

      expect(api.archivePlan).toHaveBeenCalledWith({ planId: "archive-me" });
      const plan = usePlanStore.getState().plansList[0];
      expect(plan.archivedAt).toBeTruthy();
      expect(typeof plan.archivedAt).toBe("string");
    });

    it("should only update the matching plan in plansList", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "p1", summary: "One", status: "ready", projectPath: "/1", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
          { id: "p2", summary: "Two", status: "ready", projectPath: "/2", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
        ],
      });
      api.archivePlan.mockResolvedValue(undefined);

      await usePlanStore.getState().archivePlan("p1");

      const list = usePlanStore.getState().plansList;
      expect(list[0].archivedAt).toBeTruthy();
      expect(list[1].archivedAt).toBeNull();
    });

    it("should set error on API failure without modifying list", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "fail-archive", summary: "Fail", status: "ready", projectPath: "/f", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
        ],
      });
      api.archivePlan.mockRejectedValue(new Error("Archive failed"));

      await usePlanStore.getState().archivePlan("fail-archive");

      expect(usePlanStore.getState().error).toBe("Archive failed");
      expect(usePlanStore.getState().plansList[0].archivedAt).toBeNull();
    });
  });

  // ── unarchivePlan ────────────────────────────────────

  describe("unarchivePlan", () => {
    it("should call API and clear archivedAt in plansList", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "unarchive-me", summary: "Archived", status: "ready", projectPath: "/u", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: "2025-06-01T00:00:00.000Z" },
        ],
      });
      api.unarchivePlan.mockResolvedValue(undefined);

      await usePlanStore.getState().unarchivePlan("unarchive-me");

      expect(api.unarchivePlan).toHaveBeenCalledWith({ planId: "unarchive-me" });
      expect(usePlanStore.getState().plansList[0].archivedAt).toBeNull();
    });

    it("should only update the matching plan in plansList", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "p1", summary: "One", status: "ready", projectPath: "/1", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: "2025-06-01T00:00:00.000Z" },
          { id: "p2", summary: "Two", status: "ready", projectPath: "/2", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: "2025-06-02T00:00:00.000Z" },
        ],
      });
      api.unarchivePlan.mockResolvedValue(undefined);

      await usePlanStore.getState().unarchivePlan("p1");

      const list = usePlanStore.getState().plansList;
      expect(list[0].archivedAt).toBeNull();
      expect(list[1].archivedAt).toBe("2025-06-02T00:00:00.000Z");
    });

    it("should set error on API failure without modifying list", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "fail-unarchive", summary: "Fail", status: "ready", projectPath: "/f", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: "2025-06-01T00:00:00.000Z" },
        ],
      });
      api.unarchivePlan.mockRejectedValue(new Error("Unarchive failed"));

      await usePlanStore.getState().unarchivePlan("fail-unarchive");

      expect(usePlanStore.getState().error).toBe("Unarchive failed");
      expect(usePlanStore.getState().plansList[0].archivedAt).toBe("2025-06-01T00:00:00.000Z");
    });
  });

  // ── archivePlan / unarchivePlan toggle ───────────────

  describe("archive/unarchive toggle", () => {
    it("should toggle archive state: null -> timestamped -> null", async () => {
      usePlanStore.setState({
        plansList: [
          { id: "toggle-me", summary: "Toggle", status: "ready", projectPath: "/t", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
        ],
      });
      api.archivePlan.mockResolvedValue(undefined);
      api.unarchivePlan.mockResolvedValue(undefined);

      // Archive
      await usePlanStore.getState().archivePlan("toggle-me");
      expect(usePlanStore.getState().plansList[0].archivedAt).toBeTruthy();

      // Unarchive
      await usePlanStore.getState().unarchivePlan("toggle-me");
      expect(usePlanStore.getState().plansList[0].archivedAt).toBeNull();
    });
  });

  // ── clearError ───────────────────────────────────────

  describe("clearError", () => {
    it("should clear error and lastIpcError", () => {
      usePlanStore.setState({
        error: "Some error",
        lastIpcError: { message: "Some error", code: "TEST" },
      });

      usePlanStore.getState().clearError();

      expect(usePlanStore.getState().error).toBeNull();
      expect(usePlanStore.getState().lastIpcError).toBeNull();
    });

    it("should be a no-op when error is already null", () => {
      usePlanStore.setState({ error: null, lastIpcError: null });

      usePlanStore.getState().clearError();

      expect(usePlanStore.getState().error).toBeNull();
    });
  });
});
