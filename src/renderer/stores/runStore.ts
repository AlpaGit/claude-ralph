import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { RunEvent, TodoItem } from "@shared/types";
import { RingBuffer } from "../components/ui/RingBuffer";
import { toastService } from "../services/toastService";
import { LRUMap } from "./LRUMap";

/** Cancel timeout in ms -- must match the backend CANCEL_TIMEOUT_MS. */
const CANCEL_TIMEOUT_MS = 10_000;

/** Maximum in-memory log lines per run, backed by RingBuffer. */
const LOG_BUFFER_CAPACITY = 5_000;

/**
 * Maximum number of runs whose log buffers are retained in memory.
 * 20 runs × 5 000 lines each ≈ reasonable memory ceiling.
 */
const MAX_BUFFERED_RUNS = 20;

/* ── Module-level ring buffer storage (LRU-bounded) ────────
 * RingBuffer instances live outside Zustand/immer state because they are
 * mutable containers that should not be proxied.  The store's `runLogs`
 * field is derived from `ringBuffer.toArray()` after each mutation so
 * React subscribers see the updated array reference.
 *
 * An LRU cache caps the number of runs with active log buffers.
 * When evicted, the RingBuffer is cleared to release its backing array
 * and the corresponding Zustand state entries (runLogs, runLogOverflow)
 * are cleaned up to free the string arrays.
 * ───────────────────────────────────────────────────────── */

/** Per-run log buffer state stored in the LRU cache. */
interface RunLogEntry {
  buffer: RingBuffer<string>;
  totalPushed: number;
}

/**
 * LRU cache of run log buffers. When a run is evicted, its RingBuffer is
 * cleared and the associated Zustand state is cleaned up.
 */
const logCache = new LRUMap<string, RunLogEntry>(
  MAX_BUFFERED_RUNS,
  (entry: RunLogEntry, runId: string) => {
    // Release the RingBuffer's backing array synchronously.
    entry.buffer.clear();

    // Defer Zustand state cleanup to the next microtask.  Eviction may fire
    // from inside an active immer `set()` recipe; calling setState()
    // synchronously would create a re-entrant produce whose commit is
    // overwritten when the outer recipe finalises (lost-update bug).
    queueMicrotask(() => {
      const state = useRunStore.getState();
      if (runId in state.runLogs || runId in state.runLogOverflow) {
        useRunStore.setState((draft) => {
          delete draft.runLogs[runId];
          delete draft.runLogOverflow[runId];
        });
      }
    });
  }
);

/** Get or create the log entry for a given runId (promotes it to most-recent). */
function getLogEntry(runId: string): RunLogEntry {
  let entry = logCache.get(runId);
  if (!entry) {
    entry = { buffer: new RingBuffer<string>(LOG_BUFFER_CAPACITY), totalPushed: 0 };
    logCache.set(runId, entry);
  }
  return entry;
}

/** Result of pushing a line into a run's ring buffer. */
interface PushResult {
  entry: RunLogEntry;
  overflow: number;
}

/** Push a line into a run's ring buffer. Returns the entry and overflow count. */
function pushToBuffer(runId: string, line: string): PushResult {
  const entry = getLogEntry(runId);
  entry.buffer.push(line);
  entry.totalPushed += 1;
  return { entry, overflow: Math.max(0, entry.totalPushed - entry.buffer.capacity) };
}

/**
 * Push a log line to a run's buffer and apply the resulting state to an immer
 * draft.  Shared by `appendLog` and `_handleRunEvent`'s "log" case to avoid
 * duplicating the push → snapshot → draft-update pattern.
 */
function applyLogLine(
  draft: { runLogs: Record<string, string[]>; runLogOverflow: Record<string, number> },
  runId: string,
  line: string,
): void {
  const { entry, overflow } = pushToBuffer(runId, line);
  draft.runLogs[runId] = entry.buffer.toArray();
  draft.runLogOverflow[runId] = overflow;
}

interface RunState {
  /**
   * Map of runId -> run status string.
   * Tracks which runs are currently active (in_progress / queued / cancelling).
   */
  activeRuns: Record<string, string>;

  /**
   * Map of runId -> streamed log lines visible in-memory.
   * Capped at LOG_BUFFER_CAPACITY (5 000) via RingBuffer; oldest lines are
   * dropped when the buffer overflows.  DB persistence is unaffected.
   */
  runLogs: Record<string, string[]>;

  /**
   * Map of runId -> number of log lines dropped due to ring buffer overflow.
   * Zero when no overflow has occurred.
   */
  runLogOverflow: Record<string, number>;

  /** Map of runId -> latest todo snapshot for the run. */
  runTodos: Record<string, TodoItem[]>;

  /** Currently selected run id for the live-run panel. */
  selectedRunId: string | null;

  /** Ring buffer of the most recent RunEvents (max 50). */
  recentEvents: RunEvent[];

  /**
   * Map of runId -> timestamp (ms) when cancel was requested.
   * Used by the UI to show cancel timeout progress.
   */
  cancelRequestedAt: Record<string, number>;

  // ── Actions ──────────────────────────────────────────────

  /** Start a task run via the backend. Returns the runId. */
  startRun: (planId: string, taskId: string) => Promise<string>;

  /** Cancel an active run. Transitions to 'cancelling' state with timeout progress. */
  cancelRun: (runId: string) => Promise<void>;

  /** Append a single log line for a run (called from the IPC event handler). */
  appendLog: (runId: string, line: string) => void;

  /** Replace the todo list snapshot for a run (called from the IPC event handler). */
  appendTodo: (runId: string, todos: TodoItem[]) => void;

  /** Set the selected run id for the live-run panel. */
  selectRun: (runId: string | null) => void;

  /** Process an incoming RunEvent from the IPC bridge. Internal use. */
  _handleRunEvent: (event: RunEvent) => void;

  /** Returns the cancel timeout constant for UI display purposes. */
  getCancelTimeoutMs: () => number;
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
    runLogOverflow: {},
    runTodos: {},
    selectedRunId: null,
    recentEvents: [],
    cancelRequestedAt: {},

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
      // Transition to 'cancelling' immediately so the UI can show progress
      set((draft) => {
        draft.activeRuns[runId] = "cancelling";
        draft.cancelRequestedAt[runId] = Date.now();
      });

      const api = getApi();
      try {
        await api.cancelRun({ runId });
      } catch {
        // Swallow; the event stream or timeout will handle final state
      }

      // After the backend responds (timeout or interrupt), mark as cancelled
      // if the event stream hasn't already transitioned the status
      set((draft) => {
        if (draft.activeRuns[runId] === "cancelling") {
          draft.activeRuns[runId] = "cancelled";
        }
        delete draft.cancelRequestedAt[runId];
      });
    },

    getCancelTimeoutMs: (): number => CANCEL_TIMEOUT_MS,

    appendLog: (runId: string, line: string): void => {
      set((draft) => {
        applyLogLine(draft, runId, line);
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
              applyLogLine(draft, event.runId, line);
            }
            break;
          }

          case "todo_update": {
            const todos = (event.payload as { todos?: TodoItem[] })?.todos ?? [];
            draft.runTodos[event.runId] = todos;
            break;
          }

          case "completed": {
            draft.activeRuns[event.runId] = event.type;
            delete draft.cancelRequestedAt[event.runId];
            toastService.success(`Task completed: ${event.taskId.slice(0, 8)}`);
            break;
          }

          case "failed": {
            draft.activeRuns[event.runId] = event.type;
            delete draft.cancelRequestedAt[event.runId];
            toastService.error(`Task failed: ${event.taskId.slice(0, 8)}`);
            break;
          }

          case "cancelled": {
            draft.activeRuns[event.runId] = event.type;
            delete draft.cancelRequestedAt[event.runId];
            toastService.info("Run cancelled.");
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

/* ── Test helpers ─────────────────────────────────────────
 * Exported for unit tests only. These allow tests to reset module-level
 * state between runs without module re-evaluation.
 * ───────────────────────────────────────────────────────── */

/** @internal Clear the LRU log cache. For tests only. */
export function _resetLogCache(): void {
  logCache.clear();
}

/** @internal Current number of entries in the LRU log cache. For tests only. */
export function _getLogCacheSize(): number {
  return logCache.size;
}

/** @internal The max buffered runs constant. For tests only. */
export const _MAX_BUFFERED_RUNS = MAX_BUFFERED_RUNS;
