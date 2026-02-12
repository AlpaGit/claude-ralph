import { create } from "zustand";

/**
 * Known roles that the orchestrator uses to dispatch to different models.
 * Each role can be mapped to a specific model identifier.
 */
export type ModelRole =
  | "planning"
  | "discovery"
  | "execution"
  | "wizard";

export interface ModelConfig {
  role: ModelRole;
  modelId: string;
}

interface SettingsState {
  /**
   * Map of role -> model configuration.
   * Keyed by ModelRole for O(1) lookups.
   */
  modelConfig: Record<ModelRole, ModelConfig>;

  /** Whether settings are currently being loaded. */
  loading: boolean;

  /** Last error from a settings operation. */
  error: string | null;

  // ── Actions ──────────────────────────────────────────────

  /**
   * Load settings from the backend.
   * NOTE: The backend does not yet expose a "settings:load" IPC channel.
   *       This currently initialises from defaults.
   */
  loadSettings: () => Promise<void>;

  /**
   * Update the model id used for a specific role.
   * NOTE: The backend does not yet expose a "settings:update" IPC channel.
   *       This currently updates only local state.
   */
  updateModelForRole: (role: ModelRole, modelId: string) => Promise<void>;
}

const DEFAULT_MODEL = "claude-opus-4-6";

const defaultModelConfig: Record<ModelRole, ModelConfig> = {
  planning: { role: "planning", modelId: DEFAULT_MODEL },
  discovery: { role: "discovery", modelId: DEFAULT_MODEL },
  execution: { role: "execution", modelId: DEFAULT_MODEL },
  wizard: { role: "wizard", modelId: DEFAULT_MODEL },
};

export const useSettingsStore = create<SettingsState>((set) => ({
  modelConfig: { ...defaultModelConfig },
  loading: false,
  error: null,

  loadSettings: async (): Promise<void> => {
    set({ loading: true, error: null });
    try {
      // TODO: wire up when backend exposes "settings:load" IPC channel.
      // For now, reset to defaults.
      set({ modelConfig: { ...defaultModelConfig } });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to load settings.";
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  updateModelForRole: async (role: ModelRole, modelId: string): Promise<void> => {
    set({ error: null });
    try {
      // TODO: wire up when backend exposes "settings:update" IPC channel.
      set((state) => ({
        modelConfig: {
          ...state.modelConfig,
          [role]: { role, modelId },
        },
      }));
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to update model setting.";
      set({ error: message });
    }
  },
}));
