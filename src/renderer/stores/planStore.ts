import { create } from "zustand";
import type { RalphPlan } from "@shared/types";

/** Lightweight plan summary for the plans list sidebar. */
export interface PlanSummary {
  id: string;
  summary: string;
  status: string;
  projectPath: string;
  createdAt: string;
}

interface PlanState {
  /** The fully-loaded plan currently being viewed / worked on. */
  currentPlan: RalphPlan | null;

  /** List of all plans (lightweight summaries). */
  plansList: PlanSummary[];

  /** Whether a plan is currently being loaded. */
  loadingPlan: boolean;

  /** Whether the plans list is currently being fetched. */
  loadingList: boolean;

  /** Whether a plan is currently being created. */
  creating: boolean;

  /** Last error message from any plan operation. */
  error: string | null;

  // ── Actions ──────────────────────────────────────────────

  /** Create a new plan from PRD text and project path. */
  createPlan: (prdText: string, projectPath: string) => Promise<string>;

  /** Load a single plan by id and set it as currentPlan. */
  loadPlan: (planId: string) => Promise<void>;

  /**
   * Reload the plans list.
   * NOTE: The backend does not yet expose a "plan:list" IPC channel.
   *       When it does, this action should call it. For now the list
   *       is populated from the currentPlan only.
   */
  loadPlanList: () => Promise<void>;

  /**
   * Delete a plan by id.
   * NOTE: The backend does not yet expose a "plan:delete" IPC channel.
   *       This is a placeholder that removes the plan from the local list.
   */
  deletePlan: (planId: string) => Promise<void>;

  /**
   * Archive a plan by id.
   * NOTE: The backend does not yet expose a "plan:archive" IPC channel.
   *       This is a placeholder that updates status locally.
   */
  archivePlan: (planId: string) => Promise<void>;

  /** Clear the current error. */
  clearError: () => void;
}

function getApi(): typeof window.ralphApi {
  const api = window.ralphApi;
  if (!api) {
    throw new Error("Preload bridge is unavailable (window.ralphApi is undefined).");
  }
  return api;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  currentPlan: null,
  plansList: [],
  loadingPlan: false,
  loadingList: false,
  creating: false,
  error: null,

  createPlan: async (prdText: string, projectPath: string): Promise<string> => {
    set({ creating: true, error: null });
    try {
      const api = getApi();
      const result = await api.createPlan({ prdText, projectPath });
      // Auto-load the newly created plan.
      await get().loadPlan(result.planId);
      return result.planId;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to create plan.";
      set({ error: message });
      throw caught;
    } finally {
      set({ creating: false });
    }
  },

  loadPlan: async (planId: string): Promise<void> => {
    set({ loadingPlan: true, error: null });
    try {
      const api = getApi();
      const plan = await api.getPlan(planId);
      set({ currentPlan: plan });

      // Keep the plansList in sync when we successfully load a plan.
      if (plan) {
        const summary: PlanSummary = {
          id: plan.id,
          summary: plan.summary,
          status: plan.status,
          projectPath: plan.projectPath,
          createdAt: plan.createdAt,
        };
        set((state) => {
          const existing = state.plansList.findIndex((p) => p.id === plan.id);
          const next = [...state.plansList];
          if (existing >= 0) {
            next[existing] = summary;
          } else {
            next.unshift(summary);
          }
          return { plansList: next };
        });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to load plan.";
      set({ error: message });
    } finally {
      set({ loadingPlan: false });
    }
  },

  loadPlanList: async (): Promise<void> => {
    set({ loadingList: true, error: null });
    try {
      // TODO: wire up when backend exposes "plan:list" IPC channel.
      // For now this is a no-op; the list is built from loadPlan calls.
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to load plans list.";
      set({ error: message });
    } finally {
      set({ loadingList: false });
    }
  },

  deletePlan: async (planId: string): Promise<void> => {
    set({ error: null });
    try {
      // TODO: wire up when backend exposes "plan:delete" IPC channel.
      set((state) => ({
        plansList: state.plansList.filter((p) => p.id !== planId),
        currentPlan: state.currentPlan?.id === planId ? null : state.currentPlan,
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to delete plan.";
      set({ error: message });
    }
  },

  archivePlan: async (planId: string): Promise<void> => {
    set({ error: null });
    try {
      // TODO: wire up when backend exposes "plan:archive" IPC channel.
      set((state) => ({
        plansList: state.plansList.map((p) =>
          p.id === planId ? { ...p, status: "archived" } : p
        ),
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to archive plan.";
      set({ error: message });
    }
  },

  clearError: (): void => {
    set({ error: null });
  },
}));
