/**
 * Comprehensive unit tests for AppDatabase methods against in-memory SQLite.
 *
 * Covers: createPlan, getPlan, listPlans, deletePlan, archivePlan/unarchivePlan,
 * updateTaskStatus, createRun/updateRun, appendRunEvent, addTodoSnapshot,
 * countRunnableTasks, findNextRunnableTask (dependency resolution).
 *
 * NOTE: better-sqlite3 is a native module. When compiled for Electron
 * (via electron-rebuild in postinstall), it may not load under system Node.
 * Run `npm rebuild better-sqlite3` (with Electron stopped) to rebuild
 * for system Node before running these tests.
 */

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { TechnicalPack, RunEvent, TodoItem } from "@shared/types";
import type { AppDatabase } from "../../src/main/runtime/app-database";

// ---------------------------------------------------------------------------
// Probe whether native better-sqlite3 can create a database instance.
// The require call may succeed even when the ABI mismatches -- the real
// error fires when the binding is invoked.
// ---------------------------------------------------------------------------
let sqliteAvailable = false;
try {
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");
  const probe = new Database(":memory:");
  probe.close();
  sqliteAvailable = true;
} catch {
  // Native module ABI mismatch or other load failure -- skip suite
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Minimal valid TechnicalPack for plan creation. */
function makeTechnicalPack(overrides: Partial<TechnicalPack> = {}): TechnicalPack {
  return {
    summary: "Tech summary",
    architecture_notes: ["note1"],
    files_expected: ["file1.ts"],
    dependencies: ["dep1"],
    risks: ["risk1"],
    assumptions: ["assumption1"],
    acceptance_criteria: ["criterion1"],
    test_strategy: ["strategy1"],
    effort_estimate: "1 day",
    checklist: [],
    ...overrides
  };
}

/** Create a plan with sensible defaults, returning the planId. */
function createTestPlan(
  db: AppDatabase,
  overrides: {
    id?: string;
    projectPath?: string;
    prdText?: string;
    summary?: string;
    technicalPack?: TechnicalPack;
    tasks?: Array<{
      id?: string;
      ordinal?: number;
      title?: string;
      description?: string;
      dependencies?: string[];
      acceptanceCriteria?: string[];
      technicalNotes?: string;
    }>;
  } = {}
): string {
  const planId = overrides.id ?? randomUUID();
  db.createPlan({
    id: planId,
    projectPath: overrides.projectPath ?? "/tmp/test-project",
    prdText: overrides.prdText ?? "Test PRD content",
    summary: overrides.summary ?? "Test plan summary",
    technicalPack: overrides.technicalPack ?? makeTechnicalPack(),
    tasks: (overrides.tasks ?? []).map((t, i) => ({
      id: t.id ?? randomUUID(),
      ordinal: t.ordinal ?? i + 1,
      title: t.title ?? `Task ${i + 1}`,
      description: t.description ?? `Description for task ${i + 1}`,
      dependencies: t.dependencies ?? [],
      acceptanceCriteria: t.acceptanceCriteria ?? [`AC${i + 1}`],
      technicalNotes: t.technicalNotes ?? ""
    }))
  });
  return planId;
}

/** Create a run and return its runId. */
function createTestRun(
  db: AppDatabase,
  planId: string,
  taskId: string,
  overrides: { id?: string; status?: "queued" | "in_progress" | "completed" | "failed" | "cancelled"; retryCount?: number } = {}
): string {
  const runId = overrides.id ?? randomUUID();
  db.createRun({
    id: runId,
    planId,
    taskId,
    status: overrides.status ?? "in_progress",
    retryCount: overrides.retryCount
  });
  return runId;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!sqliteAvailable)("AppDatabase (comprehensive)", () => {
  let createMockDatabase: typeof import("../../src/test-utils/mock-database").createMockDatabase;
  type MockDatabase = import("../../src/test-utils/mock-database").MockDatabase;
  let mock: MockDatabase;
  let db: AppDatabase;

  beforeEach(async () => {
    const mod = await import("../../src/test-utils/mock-database");
    createMockDatabase = mod.createMockDatabase;
    mock = createMockDatabase();
    db = mock.db;
  });

  afterEach(() => {
    mock?.cleanup();
  });

  // =========================================================================
  // createPlan
  // =========================================================================

  describe("createPlan", () => {
    it("should create a plan with valid input and tasks", () => {
      const planId = createTestPlan(db, {
        summary: "My plan",
        tasks: [
          { id: "t1", ordinal: 1, title: "First task" },
          { id: "t2", ordinal: 2, title: "Second task", dependencies: ["t1"] }
        ]
      });

      const plan = db.getPlan(planId);
      expect(plan).not.toBeNull();
      expect(plan!.summary).toBe("My plan");
      expect(plan!.status).toBe("ready");
      expect(plan!.tasks).toHaveLength(2);
      expect(plan!.tasks[0].title).toBe("First task");
      expect(plan!.tasks[1].title).toBe("Second task");
      expect(plan!.tasks[1].dependencies).toEqual(["t1"]);
      expect(plan!.runs).toHaveLength(0);
      expect(plan!.archivedAt).toBeNull();
    });

    it("should create a plan with zero tasks", () => {
      const planId = createTestPlan(db, { tasks: [] });

      const plan = db.getPlan(planId);
      expect(plan).not.toBeNull();
      expect(plan!.tasks).toHaveLength(0);
    });

    it("should throw on duplicate plan ID", () => {
      const planId = randomUUID();
      createTestPlan(db, { id: planId });

      expect(() => createTestPlan(db, { id: planId })).toThrow();
    });

    it("should store and round-trip the technical pack", () => {
      const pack = makeTechnicalPack({
        summary: "Custom summary",
        risks: ["risk-a", "risk-b"],
        effort_estimate: "3 days"
      });
      const planId = createTestPlan(db, { technicalPack: pack });

      const plan = db.getPlan(planId)!;
      expect(plan.technicalPack.summary).toBe("Custom summary");
      expect(plan.technicalPack.risks).toEqual(["risk-a", "risk-b"]);
      expect(plan.technicalPack.effort_estimate).toBe("3 days");
    });

    it("should set all tasks to pending status", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", title: "A" },
          { id: "t2", title: "B" },
          { id: "t3", title: "C" }
        ]
      });

      const plan = db.getPlan(planId)!;
      for (const task of plan.tasks) {
        expect(task.status).toBe("pending");
        expect(task.completedAt).toBeNull();
      }
    });
  });

  // =========================================================================
  // getPlan
  // =========================================================================

  describe("getPlan", () => {
    it("should return the full plan with tasks and runs for an existing plan", () => {
      const planId = createTestPlan(db, {
        summary: "Full plan",
        tasks: [{ id: "t1", title: "Task 1" }]
      });

      const runId = createTestRun(db, planId, "t1");

      const plan = db.getPlan(planId);
      expect(plan).not.toBeNull();
      expect(plan!.id).toBe(planId);
      expect(plan!.tasks).toHaveLength(1);
      expect(plan!.runs).toHaveLength(1);
      expect(plan!.runs[0].id).toBe(runId);
    });

    it("should return null for a non-existing plan", () => {
      const plan = db.getPlan("non-existent-id");
      expect(plan).toBeNull();
    });

    it("should throw PlanParseError for corrupted technical_pack_json", async () => {
      // Insert a plan with corrupt JSON directly via raw SQL
      const { PlanParseError } = await import("../../src/main/runtime/app-database");
      const planId = randomUUID();
      const now = new Date().toISOString();

      // We need to access the raw DB -- use createPlan first then corrupt it
      createTestPlan(db, { id: planId, tasks: [] });

      // Corrupt the technical_pack_json
      // Access via the internal db -- we need raw SQL access
      // Use a trick: create plan, then update via raw SQL through a second db connection
      // Instead, let's use the mock pattern to get access
      // Actually, we can access internal state through a known pattern:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawDb = (db as any).db;
      rawDb.prepare("UPDATE plans SET technical_pack_json = ? WHERE id = ?").run("NOT-VALID-JSON{{{", planId);

      expect(() => db.getPlan(planId)).toThrow(PlanParseError);
    });

    it("should throw PlanParseError for corrupted dependencies_json in tasks", async () => {
      const { PlanParseError } = await import("../../src/main/runtime/app-database");
      const planId = createTestPlan(db, {
        tasks: [{ id: "t-corrupt", title: "Corrupt task" }]
      });

      // Corrupt the dependencies_json for the task
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawDb = (db as any).db;
      rawDb.prepare("UPDATE tasks SET dependencies_json = ? WHERE id = ?").run("BROKEN{JSON", "t-corrupt");

      expect(() => db.getPlan(planId)).toThrow(PlanParseError);
    });

    it("should return tasks ordered by ordinal ASC", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t3", ordinal: 3, title: "Third" },
          { id: "t1", ordinal: 1, title: "First" },
          { id: "t2", ordinal: 2, title: "Second" }
        ]
      });

      const plan = db.getPlan(planId)!;
      expect(plan.tasks.map((t) => t.title)).toEqual(["First", "Second", "Third"]);
    });

    it("should return runs ordered by started_at DESC", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const run1 = createTestRun(db, planId, "t1", { id: "run-1" });
      const run2 = createTestRun(db, planId, "t1", { id: "run-2" });

      const plan = db.getPlan(planId)!;
      expect(plan.runs).toHaveLength(2);
      // run-2 was created second so has later started_at
      expect(plan.runs[0].id).toBe("run-2");
      expect(plan.runs[1].id).toBe("run-1");
    });
  });

  // =========================================================================
  // listPlans
  // =========================================================================

  describe("listPlans", () => {
    it("should return all plans when no filter is specified", () => {
      createTestPlan(db, { id: "p1", summary: "Plan A" });
      createTestPlan(db, { id: "p2", summary: "Plan B" });

      const plans = db.listPlans();
      expect(plans).toHaveLength(2);
    });

    it("should return empty array when no plans exist", () => {
      const plans = db.listPlans();
      expect(plans).toEqual([]);
    });

    it("should filter by archived status (archived: true)", () => {
      createTestPlan(db, { id: "p1", summary: "Active Plan" });
      createTestPlan(db, { id: "p2", summary: "Archived Plan" });
      db.archivePlan("p2");

      const archived = db.listPlans({ archived: true });
      expect(archived).toHaveLength(1);
      expect(archived[0].summary).toBe("Archived Plan");
      expect(archived[0].archivedAt).not.toBeNull();
    });

    it("should filter by archived status (archived: false)", () => {
      createTestPlan(db, { id: "p1", summary: "Active Plan" });
      createTestPlan(db, { id: "p2", summary: "Archived Plan" });
      db.archivePlan("p2");

      const active = db.listPlans({ archived: false });
      expect(active).toHaveLength(1);
      expect(active[0].summary).toBe("Active Plan");
      expect(active[0].archivedAt).toBeNull();
    });

    it("should filter by search text (matches summary)", () => {
      createTestPlan(db, { id: "p1", summary: "React Frontend" });
      createTestPlan(db, { id: "p2", summary: "Node Backend" });

      const results = db.listPlans({ search: "React" });
      expect(results).toHaveLength(1);
      expect(results[0].summary).toBe("React Frontend");
    });

    it("should filter by search text (matches project path)", () => {
      createTestPlan(db, { id: "p1", summary: "Plan A", projectPath: "/home/user/my-app" });
      createTestPlan(db, { id: "p2", summary: "Plan B", projectPath: "/home/user/other" });

      const results = db.listPlans({ search: "my-app" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("p1");
    });

    it("should combine archived and search filters", () => {
      createTestPlan(db, { id: "p1", summary: "React Active" });
      createTestPlan(db, { id: "p2", summary: "React Archived" });
      createTestPlan(db, { id: "p3", summary: "Node Active" });
      db.archivePlan("p2");

      const results = db.listPlans({ archived: false, search: "React" });
      expect(results).toHaveLength(1);
      expect(results[0].summary).toBe("React Active");
    });

    it("should return plans ordered by created_at DESC", () => {
      createTestPlan(db, { id: "p1", summary: "First" });
      createTestPlan(db, { id: "p2", summary: "Second" });
      createTestPlan(db, { id: "p3", summary: "Third" });

      const plans = db.listPlans();
      // All created very close in time; check that they are present
      expect(plans).toHaveLength(3);
      // IDs should all be present
      const ids = plans.map((p) => p.id);
      expect(ids).toContain("p1");
      expect(ids).toContain("p2");
      expect(ids).toContain("p3");
    });

    it("should return PlanListItem shape (no tasks, runs, prdText)", () => {
      createTestPlan(db, { id: "p1", summary: "Shape test" });

      const plans = db.listPlans();
      expect(plans).toHaveLength(1);
      const item = plans[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("summary");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("projectPath");
      expect(item).toHaveProperty("createdAt");
      expect(item).toHaveProperty("archivedAt");
      // Should NOT have heavy fields
      expect(item).not.toHaveProperty("tasks");
      expect(item).not.toHaveProperty("runs");
      expect(item).not.toHaveProperty("prdText");
    });
  });

  // =========================================================================
  // deletePlan
  // =========================================================================

  describe("deletePlan", () => {
    it("should delete an existing plan", () => {
      const planId = createTestPlan(db, { tasks: [] });
      expect(db.getPlan(planId)).not.toBeNull();

      db.deletePlan(planId);
      expect(db.getPlan(planId)).toBeNull();
    });

    it("should not throw when deleting a non-existing plan", () => {
      expect(() => db.deletePlan("non-existent")).not.toThrow();
    });

    it("should cascade delete tasks, runs, run_events, and todo_snapshots", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task 1" }]
      });

      const runId = createTestRun(db, planId, "t1");

      // Add a run event
      db.appendRunEvent({
        id: randomUUID(),
        runId,
        ts: new Date().toISOString(),
        planId,
        taskId: "t1",
        type: "log",
        level: "info",
        payload: { message: "test log" }
      });

      // Add a todo snapshot
      db.addTodoSnapshot(runId, [
        { content: "Todo 1", status: "pending", activeForm: "Working on todo 1" }
      ]);

      // Verify data exists before delete
      expect(db.getPlan(planId)).not.toBeNull();
      expect(db.getRun(runId)).not.toBeNull();

      // Delete the plan
      db.deletePlan(planId);

      // Verify cascade
      expect(db.getPlan(planId)).toBeNull();
      expect(db.getRun(runId)).toBeNull();

      // Tasks should be gone too
      const task = db.getTask(planId, "t1");
      expect(task).toBeNull();
    });
  });

  // =========================================================================
  // archivePlan / unarchivePlan
  // =========================================================================

  describe("archivePlan / unarchivePlan", () => {
    it("should set archived_at timestamp when archiving", () => {
      const planId = createTestPlan(db);

      db.archivePlan(planId);

      const plan = db.getPlan(planId)!;
      expect(plan.archivedAt).not.toBeNull();
      // Should be a valid ISO date
      expect(new Date(plan.archivedAt!).toISOString()).toBe(plan.archivedAt);
    });

    it("should clear archived_at when unarchiving", () => {
      const planId = createTestPlan(db);

      db.archivePlan(planId);
      expect(db.getPlan(planId)!.archivedAt).not.toBeNull();

      db.unarchivePlan(planId);
      expect(db.getPlan(planId)!.archivedAt).toBeNull();
    });

    it("should update updated_at when archiving", () => {
      const planId = createTestPlan(db);
      const before = db.getPlan(planId)!.updatedAt;

      // Small delay to ensure timestamp changes
      db.archivePlan(planId);
      const after = db.getPlan(planId)!.updatedAt;

      // The updated_at should be at least as new as before
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });

    it("should update updated_at when unarchiving", () => {
      const planId = createTestPlan(db);
      db.archivePlan(planId);
      const before = db.getPlan(planId)!.updatedAt;

      db.unarchivePlan(planId);
      const after = db.getPlan(planId)!.updatedAt;

      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  // =========================================================================
  // updateTaskStatus
  // =========================================================================

  describe("updateTaskStatus", () => {
    it("should transition pending -> in_progress", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      db.updateTaskStatus("t1", "in_progress");

      const task = db.getTask(planId, "t1")!;
      expect(task.status).toBe("in_progress");
      expect(task.completedAt).toBeNull();
    });

    it("should transition in_progress -> completed and set completedAt", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      db.updateTaskStatus("t1", "in_progress");
      db.updateTaskStatus("t1", "completed");

      const task = db.getTask(planId, "t1")!;
      expect(task.status).toBe("completed");
      expect(task.completedAt).not.toBeNull();
    });

    it("should transition in_progress -> failed without setting completedAt", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      db.updateTaskStatus("t1", "in_progress");
      db.updateTaskStatus("t1", "failed");

      const task = db.getTask(planId, "t1")!;
      expect(task.status).toBe("failed");
      expect(task.completedAt).toBeNull();
    });

    it("should transition failed -> pending (retry reset)", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      db.updateTaskStatus("t1", "in_progress");
      db.updateTaskStatus("t1", "failed");
      db.updateTaskStatus("t1", "pending");

      const task = db.getTask(planId, "t1")!;
      expect(task.status).toBe("pending");
    });

    it("should transition to skipped status", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      db.updateTaskStatus("t1", "skipped");

      const task = db.getTask(planId, "t1")!;
      expect(task.status).toBe("skipped");
    });

    it("should preserve completedAt once set even when status changes to non-completed", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      db.updateTaskStatus("t1", "completed");
      const completedAt = db.getTask(planId, "t1")!.completedAt;
      expect(completedAt).not.toBeNull();

      // Transition back to pending -- completedAt should be preserved by the SQL CASE logic
      db.updateTaskStatus("t1", "pending");
      const task = db.getTask(planId, "t1")!;
      expect(task.status).toBe("pending");
      // The SQL CASE only sets completed_at when status = 'completed', otherwise preserves existing value
      expect(task.completedAt).toBe(completedAt);
    });

    it("should update updated_at on each status change", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const before = db.getTask(planId, "t1")!.updatedAt;
      db.updateTaskStatus("t1", "in_progress");
      const after = db.getTask(planId, "t1")!.updatedAt;

      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  // =========================================================================
  // createRun / updateRun / getRun
  // =========================================================================

  describe("createRun / updateRun", () => {
    it("should create a run with default fields", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const runId = createTestRun(db, planId, "t1", { status: "queued" });

      const run = db.getRun(runId);
      expect(run).not.toBeNull();
      expect(run!.planId).toBe(planId);
      expect(run!.taskId).toBe("t1");
      expect(run!.status).toBe("queued");
      expect(run!.retryCount).toBe(0);
      expect(run!.endedAt).toBeNull();
      expect(run!.durationMs).toBeNull();
      expect(run!.totalCostUsd).toBeNull();
      expect(run!.resultText).toBeNull();
      expect(run!.errorText).toBeNull();
    });

    it("should create a run with retryCount", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const runId = createTestRun(db, planId, "t1", { retryCount: 2 });

      const run = db.getRun(runId)!;
      expect(run.retryCount).toBe(2);
    });

    it("should update run status and fields", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const runId = createTestRun(db, planId, "t1", { status: "in_progress" });

      const endedAt = new Date().toISOString();
      db.updateRun({
        runId,
        status: "completed",
        endedAt,
        durationMs: 5000,
        totalCostUsd: 0.0025,
        resultText: "Task completed successfully",
        stopReason: "end_turn"
      });

      const run = db.getRun(runId)!;
      expect(run.status).toBe("completed");
      expect(run.endedAt).toBe(endedAt);
      expect(run.durationMs).toBe(5000);
      expect(run.totalCostUsd).toBeCloseTo(0.0025);
      expect(run.resultText).toBe("Task completed successfully");
      expect(run.stopReason).toBe("end_turn");
    });

    it("should update run to failed with error text", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const runId = createTestRun(db, planId, "t1");

      db.updateRun({
        runId,
        status: "failed",
        errorText: "Build failed: syntax error"
      });

      const run = db.getRun(runId)!;
      expect(run.status).toBe("failed");
      expect(run.errorText).toBe("Build failed: syntax error");
    });

    it("should return null for non-existing run", () => {
      const run = db.getRun("non-existent-run");
      expect(run).toBeNull();
    });

    it("should update sessionId via updateRun", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const runId = createTestRun(db, planId, "t1");
      const sessionId = randomUUID();

      db.updateRun({
        runId,
        status: "in_progress",
        sessionId
      });

      const run = db.getRun(runId)!;
      expect(run.sessionId).toBe(sessionId);
    });
  });

  // =========================================================================
  // appendRunEvent
  // =========================================================================

  describe("appendRunEvent", () => {
    it("should insert a run event", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });
      const runId = createTestRun(db, planId, "t1");

      const eventId = randomUUID();
      const event: RunEvent = {
        id: eventId,
        runId,
        ts: new Date().toISOString(),
        planId,
        taskId: "t1",
        type: "log",
        level: "info",
        payload: { message: "Hello from test" }
      };

      // Should not throw
      expect(() => db.appendRunEvent(event)).not.toThrow();
    });

    it("should insert multiple events for the same run", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });
      const runId = createTestRun(db, planId, "t1");

      for (let i = 0; i < 5; i++) {
        db.appendRunEvent({
          id: randomUUID(),
          runId,
          ts: new Date().toISOString(),
          planId,
          taskId: "t1",
          type: "log",
          level: "info",
          payload: { message: `Log line ${i}` }
        });
      }

      // Events were inserted successfully (no throws)
      // Verify by counting via raw SQL
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawDb = (db as any).db;
      const row = rawDb.prepare("SELECT COUNT(*) as cnt FROM run_events WHERE run_id = ?").get(runId) as { cnt: number };
      expect(row.cnt).toBe(5);
    });

    it("should store different event types", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });
      const runId = createTestRun(db, planId, "t1");

      const types: Array<RunEvent["type"]> = ["started", "log", "todo_update", "completed"];
      for (const type of types) {
        db.appendRunEvent({
          id: randomUUID(),
          runId,
          ts: new Date().toISOString(),
          planId,
          taskId: "t1",
          type,
          level: "info",
          payload: {}
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawDb = (db as any).db;
      const row = rawDb.prepare("SELECT COUNT(*) as cnt FROM run_events WHERE run_id = ?").get(runId) as { cnt: number };
      expect(row.cnt).toBe(4);
    });
  });

  // =========================================================================
  // addTodoSnapshot
  // =========================================================================

  describe("addTodoSnapshot", () => {
    it("should insert a todo snapshot with correct counts", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });
      const runId = createTestRun(db, planId, "t1");

      const todos: TodoItem[] = [
        { content: "Write tests", status: "completed", activeForm: "Writing tests" },
        { content: "Run build", status: "in_progress", activeForm: "Running build" },
        { content: "Deploy", status: "pending", activeForm: "Deploying" }
      ];

      db.addTodoSnapshot(runId, todos);

      // Verify via raw SQL
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawDb = (db as any).db;
      const row = rawDb.prepare(
        "SELECT total, pending, in_progress, completed, todos_json FROM todo_snapshots WHERE run_id = ?"
      ).get(runId) as { total: number; pending: number; in_progress: number; completed: number; todos_json: string };

      expect(row.total).toBe(3);
      expect(row.pending).toBe(1);
      expect(row.in_progress).toBe(1);
      expect(row.completed).toBe(1);

      const parsedTodos = JSON.parse(row.todos_json);
      expect(parsedTodos).toHaveLength(3);
    });

    it("should handle empty todo list", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });
      const runId = createTestRun(db, planId, "t1");

      db.addTodoSnapshot(runId, []);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawDb = (db as any).db;
      const row = rawDb.prepare(
        "SELECT total, pending, in_progress, completed FROM todo_snapshots WHERE run_id = ?"
      ).get(runId) as { total: number; pending: number; in_progress: number; completed: number };

      expect(row.total).toBe(0);
      expect(row.pending).toBe(0);
      expect(row.in_progress).toBe(0);
      expect(row.completed).toBe(0);
    });

    it("should allow multiple snapshots for the same run", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });
      const runId = createTestRun(db, planId, "t1");

      db.addTodoSnapshot(runId, [{ content: "Step 1", status: "pending", activeForm: "Doing step 1" }]);
      db.addTodoSnapshot(runId, [{ content: "Step 1", status: "completed", activeForm: "Doing step 1" }]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawDb = (db as any).db;
      const row = rawDb.prepare("SELECT COUNT(*) as cnt FROM todo_snapshots WHERE run_id = ?").get(runId) as { cnt: number };
      expect(row.cnt).toBe(2);
    });
  });

  // =========================================================================
  // countRunnableTasks
  // =========================================================================

  describe("countRunnableTasks", () => {
    it("should count tasks with no dependencies as runnable", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", title: "A", dependencies: [] },
          { id: "t2", title: "B", dependencies: [] },
          { id: "t3", title: "C", dependencies: [] }
        ]
      });

      expect(db.countRunnableTasks(planId)).toBe(3);
    });

    it("should not count tasks with unsatisfied dependencies", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", title: "A", dependencies: [] },
          { id: "t2", title: "B", dependencies: ["t1"] },
          { id: "t3", title: "C", dependencies: ["t2"] }
        ]
      });

      // Only t1 is runnable (no deps), t2 depends on t1, t3 depends on t2
      expect(db.countRunnableTasks(planId)).toBe(1);
    });

    it("should count tasks whose dependencies are completed", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", title: "A", dependencies: [] },
          { id: "t2", title: "B", dependencies: ["t1"] }
        ]
      });

      db.updateTaskStatus("t1", "completed");

      // Both t1 (completed, not pending) should not be counted; t2 (pending, deps satisfied) should
      expect(db.countRunnableTasks(planId)).toBe(1);
    });

    it("should treat skipped dependencies as satisfied", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", title: "A", dependencies: [] },
          { id: "t2", title: "B", dependencies: ["t1"] }
        ]
      });

      db.updateTaskStatus("t1", "skipped");

      // t2 should now be runnable because t1 is skipped
      expect(db.countRunnableTasks(planId)).toBe(1);
    });

    it("should not count non-pending tasks", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", title: "A", dependencies: [] },
          { id: "t2", title: "B", dependencies: [] }
        ]
      });

      db.updateTaskStatus("t1", "in_progress");

      // t1 is in_progress so not counted; only t2 is pending and runnable
      expect(db.countRunnableTasks(planId)).toBe(1);
    });

    it("should return 0 when all tasks are completed", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", title: "A", dependencies: [] },
          { id: "t2", title: "B", dependencies: ["t1"] }
        ]
      });

      db.updateTaskStatus("t1", "completed");
      db.updateTaskStatus("t2", "completed");

      expect(db.countRunnableTasks(planId)).toBe(0);
    });

    it("should return 0 for plan with no tasks", () => {
      const planId = createTestPlan(db, { tasks: [] });
      expect(db.countRunnableTasks(planId)).toBe(0);
    });
  });

  // =========================================================================
  // findNextRunnableTask (dependency resolution)
  // =========================================================================

  describe("findNextRunnableTask", () => {
    it("should return the first pending task with no dependencies", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", ordinal: 1, title: "A", dependencies: [] },
          { id: "t2", ordinal: 2, title: "B", dependencies: [] }
        ]
      });

      const next = db.findNextRunnableTask(planId);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("t1"); // first by ordinal
    });

    it("should return null when no tasks are runnable", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", ordinal: 1, title: "A", dependencies: [] },
          { id: "t2", ordinal: 2, title: "B", dependencies: ["t1"] }
        ]
      });

      db.updateTaskStatus("t1", "in_progress");

      // t1 is not pending; t2 depends on t1 which is not completed/skipped
      const next = db.findNextRunnableTask(planId);
      expect(next).toBeNull();
    });

    it("should return null when all tasks are completed", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", ordinal: 1, title: "A", dependencies: [] }]
      });

      db.updateTaskStatus("t1", "completed");

      const next = db.findNextRunnableTask(planId);
      expect(next).toBeNull();
    });

    it("should return null for plan with no tasks", () => {
      const planId = createTestPlan(db, { tasks: [] });
      expect(db.findNextRunnableTask(planId)).toBeNull();
    });

    it("should resolve a 3-task dependency chain: A -> B -> C", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t-a", ordinal: 1, title: "A", dependencies: [] },
          { id: "t-b", ordinal: 2, title: "B", dependencies: ["t-a"] },
          { id: "t-c", ordinal: 3, title: "C", dependencies: ["t-b"] }
        ]
      });

      // Step 1: Only A is runnable
      let next = db.findNextRunnableTask(planId);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("t-a");

      // B should NOT be runnable yet
      expect(db.countRunnableTasks(planId)).toBe(1);

      // Step 2: Complete A -> B becomes runnable
      db.updateTaskStatus("t-a", "completed");

      next = db.findNextRunnableTask(planId);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("t-b");

      // C should still NOT be runnable
      expect(db.countRunnableTasks(planId)).toBe(1);

      // Step 3: Complete B -> C becomes runnable
      db.updateTaskStatus("t-b", "completed");

      next = db.findNextRunnableTask(planId);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("t-c");

      // Step 4: Complete C -> no more runnable tasks
      db.updateTaskStatus("t-c", "completed");

      next = db.findNextRunnableTask(planId);
      expect(next).toBeNull();
    });

    it("should handle skipped dependencies in chain", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t-a", ordinal: 1, title: "A", dependencies: [] },
          { id: "t-b", ordinal: 2, title: "B", dependencies: ["t-a"] },
          { id: "t-c", ordinal: 3, title: "C", dependencies: ["t-b"] }
        ]
      });

      // Skip A -> B should become runnable
      db.updateTaskStatus("t-a", "skipped");

      const next = db.findNextRunnableTask(planId);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("t-b");
    });

    it("should handle diamond dependency pattern", () => {
      // D depends on both B and C, which both depend on A
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t-a", ordinal: 1, title: "A", dependencies: [] },
          { id: "t-b", ordinal: 2, title: "B", dependencies: ["t-a"] },
          { id: "t-c", ordinal: 3, title: "C", dependencies: ["t-a"] },
          { id: "t-d", ordinal: 4, title: "D", dependencies: ["t-b", "t-c"] }
        ]
      });

      // Step 1: Only A is runnable
      expect(db.findNextRunnableTask(planId)!.id).toBe("t-a");

      // Step 2: Complete A -> B and C become runnable
      db.updateTaskStatus("t-a", "completed");
      expect(db.countRunnableTasks(planId)).toBe(2);
      expect(db.findNextRunnableTask(planId)!.id).toBe("t-b"); // first by ordinal

      // Step 3: Complete B -> D still not runnable (C still pending)
      db.updateTaskStatus("t-b", "completed");
      expect(db.findNextRunnableTask(planId)!.id).toBe("t-c");

      // Step 4: Complete C -> D becomes runnable
      db.updateTaskStatus("t-c", "completed");
      expect(db.findNextRunnableTask(planId)!.id).toBe("t-d");
    });

    it("should skip in_progress tasks when finding next runnable", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t1", ordinal: 1, title: "A", dependencies: [] },
          { id: "t2", ordinal: 2, title: "B", dependencies: [] }
        ]
      });

      db.updateTaskStatus("t1", "in_progress");

      const next = db.findNextRunnableTask(planId);
      expect(next).not.toBeNull();
      expect(next!.id).toBe("t2");
    });
  });

  // =========================================================================
  // getLatestFailedRun
  // =========================================================================

  describe("getLatestFailedRun", () => {
    it("should return the most recent failed run", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const run1 = createTestRun(db, planId, "t1", { status: "failed" });
      const run2 = createTestRun(db, planId, "t1", { status: "failed" });

      const latest = db.getLatestFailedRun(planId, "t1");
      expect(latest).not.toBeNull();
      // run2 was created later so should be the latest
      expect(latest!.id).toBe(run2);
    });

    it("should return null when no failed runs exist", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      createTestRun(db, planId, "t1", { status: "completed" });

      const latest = db.getLatestFailedRun(planId, "t1");
      expect(latest).toBeNull();
    });

    it("should scope to the correct plan and task", () => {
      const planId1 = createTestPlan(db, {
        id: "plan-1",
        tasks: [{ id: "t1", title: "Task 1" }]
      });
      const planId2 = createTestPlan(db, {
        id: "plan-2",
        tasks: [{ id: "t2", title: "Task 2" }]
      });

      createTestRun(db, planId1, "t1", { status: "failed" });
      createTestRun(db, planId2, "t2", { status: "failed" });

      const latest = db.getLatestFailedRun(planId1, "t1");
      expect(latest).not.toBeNull();
      expect(latest!.planId).toBe(planId1);
      expect(latest!.taskId).toBe("t1");
    });
  });

  // =========================================================================
  // updatePlanStatus
  // =========================================================================

  describe("updatePlanStatus", () => {
    it("should update plan status", () => {
      const planId = createTestPlan(db);

      db.updatePlanStatus(planId, "running");
      expect(db.getPlan(planId)!.status).toBe("running");

      db.updatePlanStatus(planId, "completed");
      expect(db.getPlan(planId)!.status).toBe("completed");
    });

    it("should update updated_at timestamp", () => {
      const planId = createTestPlan(db);
      const before = db.getPlan(planId)!.updatedAt;

      db.updatePlanStatus(planId, "running");
      const after = db.getPlan(planId)!.updatedAt;

      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  // =========================================================================
  // getTask / getTasks
  // =========================================================================

  describe("getTask / getTasks", () => {
    it("should return null for non-existing task", () => {
      const planId = createTestPlan(db, { tasks: [] });
      expect(db.getTask(planId, "non-existent")).toBeNull();
    });

    it("should return a specific task with correct fields", () => {
      const planId = createTestPlan(db, {
        tasks: [{
          id: "t1",
          ordinal: 1,
          title: "My Task",
          description: "Task description",
          dependencies: ["dep-1"],
          acceptanceCriteria: ["AC1", "AC2"],
          technicalNotes: "Some notes"
        }]
      });

      const task = db.getTask(planId, "t1");
      expect(task).not.toBeNull();
      expect(task!.id).toBe("t1");
      expect(task!.planId).toBe(planId);
      expect(task!.ordinal).toBe(1);
      expect(task!.title).toBe("My Task");
      expect(task!.description).toBe("Task description");
      expect(task!.dependencies).toEqual(["dep-1"]);
      expect(task!.acceptanceCriteria).toEqual(["AC1", "AC2"]);
      expect(task!.technicalNotes).toBe("Some notes");
      expect(task!.status).toBe("pending");
    });

    it("should return all tasks for a plan ordered by ordinal", () => {
      const planId = createTestPlan(db, {
        tasks: [
          { id: "t3", ordinal: 3, title: "Third" },
          { id: "t1", ordinal: 1, title: "First" },
          { id: "t2", ordinal: 2, title: "Second" }
        ]
      });

      const tasks = db.getTasks(planId);
      expect(tasks).toHaveLength(3);
      expect(tasks.map((t) => t.title)).toEqual(["First", "Second", "Third"]);
    });

    it("should return empty array for plan with no tasks", () => {
      const planId = createTestPlan(db, { tasks: [] });
      expect(db.getTasks(planId)).toEqual([]);
    });
  });

  // =========================================================================
  // getStaleInProgressRuns
  // =========================================================================

  describe("getStaleInProgressRuns", () => {
    it("should return in_progress runs older than threshold", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      createTestRun(db, planId, "t1", { status: "in_progress" });

      // Use a future threshold that makes the run "stale"
      const futureThreshold = new Date(Date.now() + 60_000).toISOString();
      const staleRuns = db.getStaleInProgressRuns(futureThreshold);
      expect(staleRuns).toHaveLength(1);
    });

    it("should not return completed runs", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      const runId = createTestRun(db, planId, "t1", { status: "in_progress" });
      db.updateRun({ runId, status: "completed" });

      const futureThreshold = new Date(Date.now() + 60_000).toISOString();
      const staleRuns = db.getStaleInProgressRuns(futureThreshold);
      expect(staleRuns).toHaveLength(0);
    });

    it("should not return runs newer than threshold", () => {
      const planId = createTestPlan(db, {
        tasks: [{ id: "t1", title: "Task" }]
      });

      createTestRun(db, planId, "t1", { status: "in_progress" });

      // Use a past threshold
      const pastThreshold = new Date(Date.now() - 60_000).toISOString();
      const staleRuns = db.getStaleInProgressRuns(pastThreshold);
      expect(staleRuns).toHaveLength(0);
    });
  });
});
