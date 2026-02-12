import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { RunEvent, TodoItem } from "@shared/types";

interface RunState {
  /**
   * Map of runId -> run status string.
   * Tracks which runs are currently active (in_progress / queued).
   */
  activeRuns: Record<string, string>;

  /** Map of runId -> streamed log lines. Uses immer for efficient nested updates. */
  runLogs: Record<string, string[]>;

  /** Map of runId -> latest todo snapshot for the run. */
  runTodos: Record<string, TodoItem[]>;

  /** Currently selected run id for the live-run panel. */
  selectedRunId: string | null;

  /** Ring buffer of the most recent RunEvents (max 50). */
  recentEvents: RunEvent[];

  // ── Actions ──────────────────────────────────────────────

  /** Start a task run via the backend. Returns the runId. */
  startRun: (planId: string, taskId: string) => Promise<string>;

  /** Cancel an active run. */
  cancelRun: (runId: string) => Promise<void>;

  /** Append a single log line for a run (called from the IPC event handler). */
  appendLog: (runId: string, line: string) => void;

  /** Replace the todo list snapshot for a run (called from the IPC event handler). */
  appendTodo: (runId: string, todos: TodoItem[]) => void;

  /** Set the selected run id for the live-run panel. */
  selectRun: (runId: string | null) => void;

  /** Process an incoming RunEvent from the IPC bridge. Internal use. */
  _handleRunEvent: (event: RunEvent) => void;
}

function getApi(): typeof window.ralphApi {
  const api = window.ralphApi;
  if (!api) {
    throw new Error("Preload bridge is unavailable (window.ralphApi is undefined).");
  }
  return api;
}

export const useRunStore = create<RunState>()(
  immer((set) => ({
    activeRuns: {},
    runLogs: {},
    runTodos: {},
    selectedRunId: null,
    recentEvents: [],

    startRun: async (planId: string, taskId: string): Promise<string> => {
      const api = getApi();
      const result = await api.runTask({ planId, taskId });
      set((draft) => {
        draft.activeRuns[result.runId] = "queued";
        draft.selectedRunId = result.runId;
      });
      return result.runId;
    },

    cancelRun: async (runId: string): Promise<void> => {
      const api = getApi();
      await api.cancelRun({ runId });
      set((draft) => {
        draft.activeRuns[runId] = "cancelled";
      });
    },

    appendLog: (runId: string, line: string): void => {
      set((draft) => {
        if (!draft.runLogs[runId]) {
          draft.runLogs[runId] = [];
        }
        draft.runLogs[runId].push(line);
      });
    },

    appendTodo: (runId: string, todos: TodoItem[]): void => {
      set((draft) => {
        draft.runTodos[runId] = todos;
      });
    },

    selectRun: (runId: string | null): void => {
      set((draft) => {
        draft.selectedRunId = runId;
      });
    },

    _handleRunEvent: (event: RunEvent): void => {
      set((draft) => {
        // Push into the recent events ring buffer (max 50).
        draft.recentEvents.unshift(event);
        if (draft.recentEvents.length > 50) {
          draft.recentEvents.length = 50;
        }

        switch (event.type) {
          case "started": {
            draft.activeRuns[event.runId] = "in_progress";
            draft.selectedRunId = event.runId;
            break;
          }

          case "log": {
            const line = String((event.payload as { line?: string })?.line ?? "");
            if (line.trim().length > 0) {
              if (!draft.runLogs[event.runId]) {
                draft.runLogs[event.runId] = [];
              }
              draft.runLogs[event.runId].push(line);
            }
            break;
          }

          case "todo_update": {
            const todos = (event.payload as { todos?: TodoItem[] })?.todos ?? [];
            draft.runTodos[event.runId] = todos;
            break;
          }

          case "completed":
          case "failed":
          case "cancelled": {
            draft.activeRuns[event.runId] = event.type;
            break;
          }

          case "task_status": {
            // Task status changes are handled by planStore via loadPlan.
            break;
          }

          default:
            break;
        }
      });
    },
  }))
);

/**
 * Initialize the run-event IPC subscription.
 * Call this ONCE from App.tsx on mount. Returns an unsubscribe function.
 */
export function initRunEventSubscription(): () => void {
  const api = window.ralphApi;
  if (!api) {
    // In environments without the preload bridge (e.g. unit tests), skip.
    return () => {};
  }

  const unsubscribe = api.onRunEvent((event: RunEvent) => {
    useRunStore.getState()._handleRunEvent(event);
  });

  return unsubscribe;
}
