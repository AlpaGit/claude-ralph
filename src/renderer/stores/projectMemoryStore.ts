import { create } from "zustand";
import type { IpcError, ProjectMemoryItem } from "@shared/types";
import { parseIpcError } from "../services/ipcErrorService";
import { toastService } from "../services/toastService";

interface ProjectMemoryState {
  items: ProjectMemoryItem[];
  loading: boolean;
  refreshingProjectId: string | null;
  error: string | null;
  lastIpcError: IpcError | null;
  loadProjectMemory: (search?: string) => Promise<void>;
  refreshStackProfile: (projectId: string) => Promise<void>;
  clearError: () => void;
}

function getApi(): typeof window.ralphApi {
  const api = window.ralphApi;
  if (!api) {
    throw new Error("Preload bridge is unavailable (window.ralphApi is undefined).");
  }
  return api;
}

export const useProjectMemoryStore = create<ProjectMemoryState>((set, get) => ({
  items: [],
  loading: false,
  refreshingProjectId: null,
  error: null,
  lastIpcError: null,

  loadProjectMemory: async (search?: string): Promise<void> => {
    set({ loading: true, error: null, lastIpcError: null });
    try {
      const api = getApi();
      const items = await api.listProjectMemory({
        search: search?.trim() || undefined,
        limitPlans: 6,
      });
      set({ items });
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message, lastIpcError: ipcError });
    } finally {
      set({ loading: false });
    }
  },

  refreshStackProfile: async (projectId: string): Promise<void> => {
    set({ refreshingProjectId: projectId, error: null, lastIpcError: null });
    try {
      const api = getApi();
      const updated = await api.refreshProjectStackProfile({ projectId });
      set((state) => ({
        items: state.items.map((item) => (item.projectId === projectId ? updated : item)),
      }));
      toastService.success(`Stack profile refreshed for ${updated.displayName}.`);
    } catch (caught) {
      const ipcError = parseIpcError(caught);
      set({ error: ipcError.message, lastIpcError: ipcError });
      toastService.error(ipcError.message, ipcError);
    } finally {
      if (get().refreshingProjectId === projectId) {
        set({ refreshingProjectId: null });
      }
    }
  },

  clearError: (): void => {
    set({ error: null, lastIpcError: null });
  },
}));
