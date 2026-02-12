import { create } from "zustand";
import type {
  DiscoveryAnswer,
  DiscoveryEvent,
  DiscoveryInterviewState,
} from "@shared/types";

interface DiscoveryState {
  /** The current interview state returned by the backend. */
  interview: DiscoveryInterviewState | null;

  /** Accumulated answers given across all rounds. */
  answers: DiscoveryAnswer[];

  /** Streamed discovery events (status, logs, agent messages). */
  events: DiscoveryEvent[];

  /** Whether a discovery call is currently in flight. */
  loading: boolean;

  /** Last error message from any discovery operation. */
  error: string | null;

  // ── Actions ──────────────────────────────────────────────

  /** Start a new discovery interview session. */
  startDiscovery: (
    projectPath: string,
    seedSentence: string,
    additionalContext: string
  ) => Promise<void>;

  /** Continue the interview by submitting answers to the current round. */
  continueDiscovery: (answers: DiscoveryAnswer[]) => Promise<void>;

  /** Reset the store to its initial state. */
  reset: () => void;
}

function getApi(): typeof window.ralphApi {
  const api = window.ralphApi;
  if (!api) {
    throw new Error("Preload bridge is unavailable (window.ralphApi is undefined).");
  }
  return api;
}

const initialState = {
  interview: null,
  answers: [],
  events: [],
  loading: false,
  error: null,
};

export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  ...initialState,

  startDiscovery: async (
    projectPath: string,
    seedSentence: string,
    additionalContext: string
  ): Promise<void> => {
    set({ loading: true, error: null, answers: [], events: [] });
    try {
      const api = getApi();

      // Subscribe to discovery events for this session.
      const unsubscribe = api.onDiscoveryEvent((event: DiscoveryEvent) => {
        set((state) => ({ events: [...state.events, event] }));
      });

      const result = await api.startDiscovery({
        projectPath,
        seedSentence,
        additionalContext,
      });

      set({ interview: result });

      // Store the unsubscribe function so we can clean up on reset.
      // We stash it as a closure side-effect since zustand state should
      // remain serializable.
      _discoveryUnsubscribe = unsubscribe;
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to start discovery.";
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  continueDiscovery: async (answers: DiscoveryAnswer[]): Promise<void> => {
    const { interview } = get();
    if (!interview) {
      set({ error: "No active discovery session." });
      return;
    }

    set({ loading: true, error: null });
    try {
      const api = getApi();
      const result = await api.continueDiscovery({
        sessionId: interview.sessionId,
        answers,
      });

      set((state) => ({
        interview: result,
        answers: [...state.answers, ...answers],
      }));
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Failed to continue discovery.";
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  reset: (): void => {
    // Clean up event subscription if one exists.
    if (_discoveryUnsubscribe) {
      _discoveryUnsubscribe();
      _discoveryUnsubscribe = null;
    }
    set(initialState);
  },
}));

/** Module-level holder for the discovery event unsubscribe callback. */
let _discoveryUnsubscribe: (() => void) | null = null;
