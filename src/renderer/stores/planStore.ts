import { create } from "zustand";
import type { IpcError, PlanListItem, RalphPlan } from "@shared/types";
import { parseIpcError } from "../services/ipcErrorService";
import { toastService } from "../services/toastService";

/** Lightweight plan summary for the plans list sidebar. */
export interface PlanSummary {
  id: string;
  summary: string;
  status: string;
  projectPath: string;
  createdAt: string;
  archivedAt?: string | null;
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

  /** Last structured IPC error (includes dev-mode details when available). */
  lastIpcError: IpcError | null;

  // ── Actions ──────────────────────────────────────────────

  /** Create a new plan from PRD text and project path. */
  createPlan: (prdText: string, projectPath: string) => Promise<string>;

  /** Load a single plan by id and set it as currentPlan. */
  loadPlan: (planId: string) => Promise<void>;

  /** Reload the plans list from the backend. */
  loadPlanList: (filter?: { archived?: boolean; search?: string }) => Promise<void>;

  /** Permanently delete a plan and all associated data. */
  deletePlan: (planId: string) => Promise<void>;

  /** Soft-archive a plan. */
  archivePlan: (planId: string) => Promise<void>;

  /** Remove archive status from a plan. */
  unarchivePlan: (planId: string) => Promise<void>;

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
  lastIpcError: null,

  createPlan: async (prdText: string, projectPath: string): Promise<string> => {
    set({ creating: true, error: null, lastIpcError: null });
    try {
      const api = getApi();
      const result = await api.createPlan({ prdText, projectPath });
      // Auto-load the newly created plan.
      await get().loadPlan(result.planId);
      toastService.success("Plan created successfully.");
      return result.planId;
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message, lastIpcError: ipcError });
      toastService.error(ipcError.message);
      throw caught;
    } finally {
      set({ creating: false });
    }
  },

  loadPlan: async (planId: string): Promise<void> => {
    set({ loadingPlan: true, error: null, lastIpcError: null });
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
          archivedAt: plan.archivedAt,
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
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message, lastIpcError: ipcError });
    } finally {
      set({ loadingPlan: false });
    }
  },

  loadPlanList: async (filter?: { archived?: boolean; search?: string }): Promise<void> => {
    set({ loadingList: true, error: null, lastIpcError: null });
    try {
      const api = getApi();
      const items: PlanListItem[] = await api.listPlans({ filter });
      const summaries: PlanSummary[] = items.map((item) => ({
        id: item.id,
        summary: item.summary,
        status: item.status,
        projectPath: item.projectPath,
        createdAt: item.createdAt,
        archivedAt: item.archivedAt,
      }));
      set({ plansList: summaries });
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message, lastIpcError: ipcError });
    } finally {
      set({ loadingList: false });
    }
  },

  deletePlan: async (planId: string): Promise<void> => {
    set({ error: null, lastIpcError: null });
    try {
      const api = getApi();
      await api.deletePlan({ planId });
      set((state) => ({
        plansList: state.plansList.filter((p) => p.id !== planId),
        currentPlan: state.currentPlan?.id === planId ? null : state.currentPlan,
      }));
      toastService.success("Plan deleted.");
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message, lastIpcError: ipcError });
      toastService.error(ipcError.message);
    }
  },

  archivePlan: async (planId: string): Promise<void> => {
    set({ error: null, lastIpcError: null });
    try {
      const api = getApi();
      await api.archivePlan({ planId });
      set((state) => ({
        plansList: state.plansList.map((p) =>
          p.id === planId ? { ...p, archivedAt: new Date().toISOString() } : p
        ),
      }));
      toastService.success("Plan archived.");
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message, lastIpcError: ipcError });
      toastService.error(ipcError.message);
    }
  },

  unarchivePlan: async (planId: string): Promise<void> => {
    set({ error: null, lastIpcError: null });
    try {
      const api = getApi();
      await api.unarchivePlan({ planId });
      set((state) => ({
        plansList: state.plansList.map((p) =>
          p.id === planId ? { ...p, archivedAt: null } : p
        ),
      }));
      toastService.success("Plan restored from archive.");
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message, lastIpcError: ipcError });
      toastService.error(ipcError.message);
    }
  },

  clearError: (): void => {
    set({ error: null, lastIpcError: null });
  },
}));
