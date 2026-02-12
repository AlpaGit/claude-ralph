import { create } from "zustand";
import type { AgentRole, ModelConfigEntry } from "@shared/types";

/**
 * Known roles that the orchestrator uses to dispatch to different models.
 * These map directly to the agent_role column in the model_config DB table.
 */
export type { AgentRole };

/**
 * Available model options that can be assigned to any agent role.
 */
export interface AvailableModel {
  id: string;
  label: string;
}

export const AVAILABLE_MODELS: readonly AvailableModel[] = [
  { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
] as const;

interface SettingsState {
  /**
   * Model configuration entries loaded from the backend.
   * Keyed by AgentRole for O(1) lookups.
   */
  modelConfig: Record<AgentRole, ModelConfigEntry | undefined>;

  /** Whether settings are currently being loaded. */
  loading: boolean;

  /** Last error from a settings operation. */
  error: string | null;

  // -- Actions --

  /**
   * Load model configuration from the backend via config:getModels IPC.
   */
  loadSettings: () => Promise<void>;

  /**
   * Update the model id for a specific role via config:updateModel IPC.
   * Persists to the database immediately (save-on-change).
   */
  updateModelForRole: (role: AgentRole, modelId: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  modelConfig: {
    discovery_specialist: undefined,
    plan_synthesis: undefined,
    task_execution: undefined,
  },
  loading: false,
  error: null,

  loadSettings: async (): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const entries = await window.ralphApi.getModelConfig();
      const config: Record<string, ModelConfigEntry | undefined> = {
        discovery_specialist: undefined,
        plan_synthesis: undefined,
        task_execution: undefined,
      };
      for (const entry of entries) {
        config[entry.agentRole] = entry;
      }
      set({ modelConfig: config as Record<AgentRole, ModelConfigEntry | undefined> });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to load settings.";
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  updateModelForRole: async (role: AgentRole, modelId: string): Promise<void> => {
    set({ error: null });
    try {
      await window.ralphApi.updateModelConfig({ agentRole: role, modelId });
      // Optimistically update local state after successful save.
      set((state) => {
        const existing = state.modelConfig[role];
        return {
          modelConfig: {
            ...state.modelConfig,
            [role]: {
              id: existing?.id ?? "",
              agentRole: role,
              modelId,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to update model setting.";
      set({ error: message });
    }
  },
}));
