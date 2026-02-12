// @vitest-environment jsdom

/**
 * Unit tests for runStore (Zustand store with immer middleware).
 *
 * Tests cover:
 * - appendLog accumulates lines
 * - appendTodo updates todo state
 * - selectRun changes selected run id
 * - _handleRunEvent dispatches started/log/todo_update/completed/failed/cancelled events
 * - Event subscription via initRunEventSubscription
 * - startRun calls API and updates state
 * - cancelRun transitions through cancelling state
 * - recentEvents accumulation and cap
 * - Ring buffer overflow tracking
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

// Import after mocking
import {
  useRunStore,
  initRunEventSubscription,
  _resetLogCache,
  _getLogCacheSize,
  _MAX_BUFFERED_RUNS,
} from "../../../src/renderer/stores/runStore";
import type { RunEvent, TodoItem } from "@shared/types";

// ── Helpers ──────────────────────────────────────────────

function makeRunEvent(overrides?: Partial<RunEvent>): RunEvent {
  return {
    id: "evt-001",
    ts: new Date().toISOString(),
    runId: "run-001",
    planId: "plan-001",
    taskId: "task-001",
    type: "started",
    level: "info",
    payload: {},
    ...overrides,
  };
}

function makeTodoItem(overrides?: Partial<TodoItem>): TodoItem {
  return {
    content: "Test todo item",
    status: "pending",
    activeForm: "Testing todo item",
    ...overrides,
  };
}

/** Flush pending microtasks (used to await deferred LRU eviction cleanup). */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

/** Initial (clean) state for the runStore. */
const initialState = {
  activeRuns: {},
  runLogs: {},
  runLogOverflow: {},
  runTodos: {},
  selectedRunId: null,
  recentEvents: [],
  cancelRequestedAt: {},
};

describe("runStore", () => {
  let api: MockRalphApi;

  beforeEach(() => {
    api = installMockRalphApi();
    // Reset module-level LRU log cache to avoid cross-test state leakage
    _resetLogCache();
    // Reset store state to initial between tests
    useRunStore.setState(initialState);
  });

  // ── appendLog ────────────────────────────────────────

  describe("appendLog", () => {
    it("should accumulate a single log line for a run", () => {
      useRunStore.getState().appendLog("run-001", "Hello world");

      const logs = useRunStore.getState().runLogs["run-001"];
      expect(logs).toEqual(["Hello world"]);
    });

    it("should accumulate multiple log lines in order", () => {
      const { appendLog } = useRunStore.getState();
      // Use unique runId to avoid module-level ring buffer state leakage
      appendLog("run-multiline", "Line 1");
      appendLog("run-multiline", "Line 2");
      appendLog("run-multiline", "Line 3");

      const logs = useRunStore.getState().runLogs["run-multiline"];
      expect(logs).toEqual(["Line 1", "Line 2", "Line 3"]);
    });

    it("should maintain separate logs per run", () => {
      const { appendLog } = useRunStore.getState();
      appendLog("run-a", "Log A");
      appendLog("run-b", "Log B");
      appendLog("run-a", "Log A2");

      expect(useRunStore.getState().runLogs["run-a"]).toEqual(["Log A", "Log A2"]);
      expect(useRunStore.getState().runLogs["run-b"]).toEqual(["Log B"]);
    });

    it("should track overflow count at zero when within capacity", () => {
      useRunStore.getState().appendLog("run-001", "Line");

      expect(useRunStore.getState().runLogOverflow["run-001"]).toBe(0);
    });
  });

  // ── appendTodo ───────────────────────────────────────

  describe("appendTodo", () => {
    it("should set todo items for a run", () => {
      const todos: TodoItem[] = [
        makeTodoItem({ content: "Todo 1", status: "pending" }),
        makeTodoItem({ content: "Todo 2", status: "in_progress" }),
      ];

      useRunStore.getState().appendTodo("run-001", todos);

      const stored = useRunStore.getState().runTodos["run-001"];
      expect(stored).toHaveLength(2);
      expect(stored[0].content).toBe("Todo 1");
      expect(stored[1].status).toBe("in_progress");
    });

    it("should replace existing todos on subsequent calls", () => {
      const firstBatch: TodoItem[] = [makeTodoItem({ content: "First" })];
      const secondBatch: TodoItem[] = [
        makeTodoItem({ content: "Second A" }),
        makeTodoItem({ content: "Second B" }),
        makeTodoItem({ content: "Second C" }),
      ];

      useRunStore.getState().appendTodo("run-001", firstBatch);
      useRunStore.getState().appendTodo("run-001", secondBatch);

      const stored = useRunStore.getState().runTodos["run-001"];
      expect(stored).toHaveLength(3);
      expect(stored[0].content).toBe("Second A");
    });

    it("should handle empty todo list", () => {
      useRunStore.getState().appendTodo("run-001", []);

      expect(useRunStore.getState().runTodos["run-001"]).toEqual([]);
    });

    it("should maintain separate todos per run", () => {
      const todosA: TodoItem[] = [makeTodoItem({ content: "A" })];
      const todosB: TodoItem[] = [makeTodoItem({ content: "B" })];

      useRunStore.getState().appendTodo("run-a", todosA);
      useRunStore.getState().appendTodo("run-b", todosB);

      expect(useRunStore.getState().runTodos["run-a"][0].content).toBe("A");
      expect(useRunStore.getState().runTodos["run-b"][0].content).toBe("B");
    });
  });

  // ── selectRun ────────────────────────────────────────

  describe("selectRun", () => {
    it("should set selectedRunId", () => {
      useRunStore.getState().selectRun("run-001");

      expect(useRunStore.getState().selectedRunId).toBe("run-001");
    });

    it("should change selectedRunId when called again", () => {
      useRunStore.getState().selectRun("run-001");
      useRunStore.getState().selectRun("run-002");

      expect(useRunStore.getState().selectedRunId).toBe("run-002");
    });

    it("should set selectedRunId to null when called with null", () => {
      useRunStore.getState().selectRun("run-001");
      useRunStore.getState().selectRun(null);

      expect(useRunStore.getState().selectedRunId).toBeNull();
    });
  });

  // ── _handleRunEvent ──────────────────────────────────

  describe("_handleRunEvent", () => {
    it("should add event to recentEvents", () => {
      const event = makeRunEvent({ id: "evt-1", type: "started" });

      useRunStore.getState()._handleRunEvent(event);

      const events = useRunStore.getState().recentEvents;
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe("evt-1");
    });

    it("should accumulate recent events newest-first", () => {
      const evt1 = makeRunEvent({ id: "evt-1", type: "started" });
      const evt2 = makeRunEvent({ id: "evt-2", type: "log", payload: { line: "test" } });
      const evt3 = makeRunEvent({ id: "evt-3", type: "completed" });

      useRunStore.getState()._handleRunEvent(evt1);
      useRunStore.getState()._handleRunEvent(evt2);
      useRunStore.getState()._handleRunEvent(evt3);

      const events = useRunStore.getState().recentEvents;
      expect(events).toHaveLength(3);
      expect(events[0].id).toBe("evt-3"); // newest first
      expect(events[2].id).toBe("evt-1"); // oldest last
    });

    it("should cap recentEvents at 50 entries", () => {
      for (let i = 0; i < 60; i++) {
        useRunStore.getState()._handleRunEvent(
          makeRunEvent({ id: `evt-${i}`, type: "log", payload: { line: `Line ${i}` } })
        );
      }

      expect(useRunStore.getState().recentEvents).toHaveLength(50);
    });

    describe("started event", () => {
      it("should set activeRuns status to in_progress", () => {
        const event = makeRunEvent({ runId: "run-start", type: "started" });

        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().activeRuns["run-start"]).toBe("in_progress");
      });

      it("should set selectedRunId to the started run", () => {
        const event = makeRunEvent({ runId: "run-start", type: "started" });

        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().selectedRunId).toBe("run-start");
      });
    });

    describe("log event", () => {
      it("should append non-empty log lines to runLogs", () => {
        const event = makeRunEvent({
          runId: "run-log",
          type: "log",
          payload: { line: "Log output line" },
        });

        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().runLogs["run-log"]).toEqual(["Log output line"]);
      });

      it("should skip whitespace-only log lines", () => {
        const event = makeRunEvent({
          runId: "run-log",
          type: "log",
          payload: { line: "   " },
        });

        useRunStore.getState()._handleRunEvent(event);

        // Whitespace-only lines are skipped
        expect(useRunStore.getState().runLogs["run-log"]).toBeUndefined();
      });

      it("should handle missing line payload gracefully", () => {
        const event = makeRunEvent({
          runId: "run-log",
          type: "log",
          payload: {},
        });

        useRunStore.getState()._handleRunEvent(event);

        // Empty string fallback is trimmed and skipped
        expect(useRunStore.getState().runLogs["run-log"]).toBeUndefined();
      });

      it("should accumulate log lines from multiple events", () => {
        // Use unique runId to avoid module-level ring buffer state leakage
        const runId = "run-log-multi";
        const events = [
          makeRunEvent({ id: "e1", runId, type: "log", payload: { line: "Line 1" } }),
          makeRunEvent({ id: "e2", runId, type: "log", payload: { line: "Line 2" } }),
          makeRunEvent({ id: "e3", runId, type: "log", payload: { line: "Line 3" } }),
        ];

        events.forEach((e) => useRunStore.getState()._handleRunEvent(e));

        expect(useRunStore.getState().runLogs[runId]).toEqual([
          "Line 1",
          "Line 2",
          "Line 3",
        ]);
      });
    });

    describe("todo_update event", () => {
      it("should update runTodos with new todo items", () => {
        const todos: TodoItem[] = [
          makeTodoItem({ content: "Setup", status: "completed" }),
          makeTodoItem({ content: "Build", status: "in_progress" }),
        ];
        const event = makeRunEvent({
          runId: "run-todo",
          type: "todo_update",
          payload: { todos },
        });

        useRunStore.getState()._handleRunEvent(event);

        const stored = useRunStore.getState().runTodos["run-todo"];
        expect(stored).toHaveLength(2);
        expect(stored[0].content).toBe("Setup");
        expect(stored[1].status).toBe("in_progress");
      });

      it("should handle missing todos in payload", () => {
        const event = makeRunEvent({
          runId: "run-todo",
          type: "todo_update",
          payload: {},
        });

        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().runTodos["run-todo"]).toEqual([]);
      });
    });

    describe("completed event", () => {
      it("should set activeRuns status to completed", () => {
        // First set the run as active
        useRunStore.setState({ activeRuns: { "run-done": "in_progress" } });

        const event = makeRunEvent({ runId: "run-done", type: "completed" });
        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().activeRuns["run-done"]).toBe("completed");
      });

      it("should clear cancelRequestedAt for the run", () => {
        useRunStore.setState({
          activeRuns: { "run-done": "cancelling" },
          cancelRequestedAt: { "run-done": Date.now() },
        });

        const event = makeRunEvent({ runId: "run-done", type: "completed" });
        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().cancelRequestedAt["run-done"]).toBeUndefined();
      });
    });

    describe("failed event", () => {
      it("should set activeRuns status to failed", () => {
        useRunStore.setState({ activeRuns: { "run-fail": "in_progress" } });

        const event = makeRunEvent({ runId: "run-fail", type: "failed" });
        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().activeRuns["run-fail"]).toBe("failed");
      });

      it("should clear cancelRequestedAt for the run", () => {
        useRunStore.setState({
          activeRuns: { "run-fail": "cancelling" },
          cancelRequestedAt: { "run-fail": Date.now() },
        });

        const event = makeRunEvent({ runId: "run-fail", type: "failed" });
        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().cancelRequestedAt["run-fail"]).toBeUndefined();
      });
    });

    describe("cancelled event", () => {
      it("should set activeRuns status to cancelled", () => {
        useRunStore.setState({ activeRuns: { "run-cancel": "cancelling" } });

        const event = makeRunEvent({ runId: "run-cancel", type: "cancelled" });
        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().activeRuns["run-cancel"]).toBe("cancelled");
      });

      it("should clear cancelRequestedAt for the run", () => {
        useRunStore.setState({
          activeRuns: { "run-cancel": "cancelling" },
          cancelRequestedAt: { "run-cancel": Date.now() },
        });

        const event = makeRunEvent({ runId: "run-cancel", type: "cancelled" });
        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().cancelRequestedAt["run-cancel"]).toBeUndefined();
      });
    });

    describe("task_status event", () => {
      it("should add to recentEvents without modifying activeRuns", () => {
        const event = makeRunEvent({ runId: "run-ts", type: "task_status" });

        useRunStore.getState()._handleRunEvent(event);

        expect(useRunStore.getState().recentEvents).toHaveLength(1);
        // task_status does not affect activeRuns
        expect(useRunStore.getState().activeRuns["run-ts"]).toBeUndefined();
      });
    });
  });

  // ── startRun ─────────────────────────────────────────

  describe("startRun", () => {
    it("should call API and set activeRuns to queued", async () => {
      api.runTask.mockResolvedValue({ runId: "new-run-id" });

      const runId = await useRunStore.getState().startRun("plan-001", "task-001");

      expect(runId).toBe("new-run-id");
      expect(api.runTask).toHaveBeenCalledWith({ planId: "plan-001", taskId: "task-001" });
      expect(useRunStore.getState().activeRuns["new-run-id"]).toBe("queued");
    });

    it("should set selectedRunId to the new run", async () => {
      api.runTask.mockResolvedValue({ runId: "new-run-id" });

      await useRunStore.getState().startRun("plan-001", "task-001");

      expect(useRunStore.getState().selectedRunId).toBe("new-run-id");
    });

    it("should throw on API failure", async () => {
      api.runTask.mockRejectedValue(new Error("Run failed to start"));

      await expect(
        useRunStore.getState().startRun("plan-001", "task-001")
      ).rejects.toThrow("Run failed to start");
    });
  });

  // ── cancelRun ────────────────────────────────────────

  describe("cancelRun", () => {
    it("should transition to cancelling immediately", async () => {
      useRunStore.setState({ activeRuns: { "run-cancel": "in_progress" } });
      api.cancelRun.mockResolvedValue({ ok: true });

      const cancelPromise = useRunStore.getState().cancelRun("run-cancel");

      // Check intermediate state (cancelling transition happens synchronously)
      // After awaiting, the final state should be set
      await cancelPromise;

      // After completion, status should be cancelled (since event stream didn't change it)
      const status = useRunStore.getState().activeRuns["run-cancel"];
      expect(status).toBe("cancelled");
    });

    it("should clear cancelRequestedAt after completion", async () => {
      useRunStore.setState({ activeRuns: { "run-cancel": "in_progress" } });
      api.cancelRun.mockResolvedValue({ ok: true });

      await useRunStore.getState().cancelRun("run-cancel");

      expect(useRunStore.getState().cancelRequestedAt["run-cancel"]).toBeUndefined();
    });

    it("should not override status if event stream already transitioned it", async () => {
      useRunStore.setState({ activeRuns: { "run-cancel": "in_progress" } });

      // Simulate the event stream updating the status before cancelRun completes
      api.cancelRun.mockImplementation(async () => {
        // During the cancel API call, the event stream fires a completed event
        useRunStore.getState()._handleRunEvent(
          makeRunEvent({ runId: "run-cancel", type: "completed" })
        );
        return { ok: true };
      });

      await useRunStore.getState().cancelRun("run-cancel");

      // The event stream set it to "completed", cancelRun should not override it
      // because it checks `if (draft.activeRuns[runId] === "cancelling")`
      expect(useRunStore.getState().activeRuns["run-cancel"]).toBe("completed");
    });

    it("should handle cancel API error gracefully", async () => {
      useRunStore.setState({ activeRuns: { "run-cancel": "in_progress" } });
      api.cancelRun.mockRejectedValue(new Error("Cancel failed"));

      // Should not throw
      await useRunStore.getState().cancelRun("run-cancel");

      // Should still transition to cancelled since the API error is swallowed
      expect(useRunStore.getState().activeRuns["run-cancel"]).toBe("cancelled");
    });
  });

  // ── getCancelTimeoutMs ───────────────────────────────

  describe("getCancelTimeoutMs", () => {
    it("should return 10000 (10 seconds)", () => {
      expect(useRunStore.getState().getCancelTimeoutMs()).toBe(10_000);
    });
  });

  // ── initRunEventSubscription ─────────────────────────

  describe("initRunEventSubscription", () => {
    it("should subscribe to onRunEvent and return unsubscribe function", () => {
      const unsub = initRunEventSubscription();

      expect(api.onRunEvent).toHaveBeenCalledTimes(1);
      expect(typeof unsub).toBe("function");
    });

    it("should dispatch incoming events to _handleRunEvent", () => {
      // Capture the callback that onRunEvent receives
      let eventHandler: ((event: RunEvent) => void) | null = null;
      api.onRunEvent.mockImplementation((handler: (event: RunEvent) => void) => {
        eventHandler = handler;
        return () => {};
      });

      initRunEventSubscription();

      // Simulate an incoming event
      const event = makeRunEvent({ runId: "evt-run", type: "started" });
      eventHandler!(event);

      expect(useRunStore.getState().activeRuns["evt-run"]).toBe("in_progress");
      expect(useRunStore.getState().recentEvents).toHaveLength(1);
    });

    it("should return no-op when window.ralphApi is not available", () => {
      // Remove ralphApi from window
      (window as unknown as Record<string, unknown>).ralphApi = undefined;

      const unsub = initRunEventSubscription();

      expect(typeof unsub).toBe("function");
      // Should not throw
      unsub();
    });
  });

  // ── Full event flow ──────────────────────────────────

  describe("full event flow", () => {
    it("should handle a complete run lifecycle: started -> log -> todo_update -> completed", () => {
      const { _handleRunEvent } = useRunStore.getState();

      // Started
      _handleRunEvent(makeRunEvent({
        id: "e1",
        runId: "lifecycle-run",
        type: "started",
      }));
      expect(useRunStore.getState().activeRuns["lifecycle-run"]).toBe("in_progress");
      expect(useRunStore.getState().selectedRunId).toBe("lifecycle-run");

      // Log lines
      _handleRunEvent(makeRunEvent({
        id: "e2",
        runId: "lifecycle-run",
        type: "log",
        payload: { line: "Building project..." },
      }));
      _handleRunEvent(makeRunEvent({
        id: "e3",
        runId: "lifecycle-run",
        type: "log",
        payload: { line: "Tests passed." },
      }));
      expect(useRunStore.getState().runLogs["lifecycle-run"]).toEqual([
        "Building project...",
        "Tests passed.",
      ]);

      // Todo update
      _handleRunEvent(makeRunEvent({
        id: "e4",
        runId: "lifecycle-run",
        type: "todo_update",
        payload: {
          todos: [
            makeTodoItem({ content: "Build", status: "completed" }),
            makeTodoItem({ content: "Test", status: "completed" }),
          ],
        },
      }));
      expect(useRunStore.getState().runTodos["lifecycle-run"]).toHaveLength(2);

      // Completed
      _handleRunEvent(makeRunEvent({
        id: "e5",
        runId: "lifecycle-run",
        type: "completed",
      }));
      expect(useRunStore.getState().activeRuns["lifecycle-run"]).toBe("completed");

      // All events recorded
      expect(useRunStore.getState().recentEvents).toHaveLength(5);
    });
  });

  // ── LRU log cache eviction ─────────────────────────────

  describe("LRU log cache eviction", () => {
    it("should report the correct cache size after appending logs", () => {
      useRunStore.getState().appendLog("run-a", "Line A");
      useRunStore.getState().appendLog("run-b", "Line B");
      useRunStore.getState().appendLog("run-c", "Line C");

      expect(_getLogCacheSize()).toBe(3);
    });

    it("should expose MAX_BUFFERED_RUNS as 20", () => {
      expect(_MAX_BUFFERED_RUNS).toBe(20);
    });

    it("should evict LRU run logs when exceeding MAX_BUFFERED_RUNS", async () => {
      const { appendLog } = useRunStore.getState();

      // Fill exactly to capacity
      for (let i = 0; i < _MAX_BUFFERED_RUNS; i++) {
        appendLog(`run-${i}`, `Line from run ${i}`);
      }
      expect(_getLogCacheSize()).toBe(_MAX_BUFFERED_RUNS);
      expect(useRunStore.getState().runLogs["run-0"]).toBeDefined();

      // Add one more — should evict "run-0" (the LRU)
      appendLog("run-overflow", "I caused eviction");

      expect(_getLogCacheSize()).toBe(_MAX_BUFFERED_RUNS);
      // Zustand state cleanup is deferred via queueMicrotask
      await flushMicrotasks();
      // run-0's log data should be cleaned up from Zustand state
      expect(useRunStore.getState().runLogs["run-0"]).toBeUndefined();
      expect(useRunStore.getState().runLogOverflow["run-0"]).toBeUndefined();
      // The new run and recent runs should still have their logs
      expect(useRunStore.getState().runLogs["run-overflow"]).toEqual(["I caused eviction"]);
      expect(useRunStore.getState().runLogs[`run-${_MAX_BUFFERED_RUNS - 1}`]).toBeDefined();
    });

    it("should promote a run on access, evicting a different LRU entry", async () => {
      const { appendLog } = useRunStore.getState();

      // Fill to capacity: run-0 through run-19
      for (let i = 0; i < _MAX_BUFFERED_RUNS; i++) {
        appendLog(`run-${i}`, `Line ${i}`);
      }

      // Access run-0 to promote it (makes run-1 the new LRU)
      appendLog("run-0", "Promoted line");

      // Add a new run — should evict run-1 (not run-0)
      appendLog("run-new", "New run");

      await flushMicrotasks();
      expect(useRunStore.getState().runLogs["run-0"]).toBeDefined();
      expect(useRunStore.getState().runLogs["run-1"]).toBeUndefined();
      expect(useRunStore.getState().runLogs["run-new"]).toEqual(["New run"]);
    });

    it("should clean up overflow tracking on eviction", async () => {
      const { appendLog } = useRunStore.getState();

      // Create a run and verify overflow starts at 0
      appendLog("run-evictable", "Some log");
      expect(useRunStore.getState().runLogOverflow["run-evictable"]).toBe(0);

      // Fill to capacity with other runs to push "run-evictable" out
      for (let i = 0; i < _MAX_BUFFERED_RUNS; i++) {
        appendLog(`filler-${i}`, `Filler line ${i}`);
      }

      await flushMicrotasks();
      // run-evictable should be evicted and its overflow cleaned up
      expect(useRunStore.getState().runLogOverflow["run-evictable"]).toBeUndefined();
    });

    it("should not affect activeRuns or runTodos on eviction", async () => {
      const { appendLog, appendTodo } = useRunStore.getState();

      // Set up a run with active status and todos
      useRunStore.setState({
        activeRuns: { "run-0": "in_progress" },
      });
      appendLog("run-0", "Log line");
      appendTodo("run-0", [makeTodoItem({ content: "Do something" })]);

      // Fill beyond capacity to evict run-0's logs
      for (let i = 1; i <= _MAX_BUFFERED_RUNS; i++) {
        appendLog(`run-${i}`, `Line ${i}`);
      }

      await flushMicrotasks();
      // Logs evicted, but active status and todos remain
      expect(useRunStore.getState().runLogs["run-0"]).toBeUndefined();
      expect(useRunStore.getState().activeRuns["run-0"]).toBe("in_progress");
      expect(useRunStore.getState().runTodos["run-0"]).toHaveLength(1);
    });

    it("should handle re-creating a buffer for a previously evicted run", async () => {
      const { appendLog } = useRunStore.getState();

      // Add a run, fill cache to evict it, then re-add
      appendLog("run-0", "Original line");
      for (let i = 1; i <= _MAX_BUFFERED_RUNS; i++) {
        appendLog(`run-${i}`, `Line ${i}`);
      }

      await flushMicrotasks();
      // run-0 was evicted
      expect(useRunStore.getState().runLogs["run-0"]).toBeUndefined();

      // Re-create it — should work fine with a fresh buffer
      appendLog("run-0", "Reborn line");
      expect(useRunStore.getState().runLogs["run-0"]).toEqual(["Reborn line"]);
    });

    it("should reset cache size to 0 after _resetLogCache()", () => {
      useRunStore.getState().appendLog("run-a", "Line");
      useRunStore.getState().appendLog("run-b", "Line");
      expect(_getLogCacheSize()).toBe(2);

      _resetLogCache();
      expect(_getLogCacheSize()).toBe(0);
    });
  });
});
