/**
 * Smoke test for the in-memory mock database factory.
 * Verifies that all migrations apply cleanly and basic CRUD works.
 *
 * NOTE: better-sqlite3 is a native module. When compiled for Electron
 * (via electron-rebuild in postinstall), it may not load under system Node.
 * Run `npm rebuild better-sqlite3` (with Electron stopped) to rebuild
 * for system Node before running these tests.
 */

import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Probe whether the native better-sqlite3 module can actually create
 * a database instance. The `require` call may succeed even when the
 * ABI mismatches -- the real error fires when the binding is invoked.
 */
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

describe.skipIf(!sqliteAvailable)("AppDatabase (in-memory)", () => {
  /* eslint-disable @typescript-eslint/consistent-type-imports -- dynamic import() type annotations */
  let createMockDatabase: typeof import("../../test-utils/mock-database").createMockDatabase;
  type MockDatabase = import("../../test-utils/mock-database").MockDatabase;
  /* eslint-enable @typescript-eslint/consistent-type-imports */
  let mock: MockDatabase;

  beforeEach(async () => {
    const mod = await import("../../test-utils/mock-database");
    createMockDatabase = mod.createMockDatabase;
    mock = createMockDatabase();
  });

  afterEach(() => {
    mock?.cleanup();
  });

  it("should create an in-memory database with all migrations applied", () => {
    expect(mock.db).toBeDefined();
  });

  it("should support createPlan and getPlan round-trip", () => {
    const planId = "test-plan-001";

    mock.db.createPlan({
      id: planId,
      projectPath: "/tmp/test-project",
      prdText: "Test PRD content",
      summary: "Test plan summary",
      technicalPack: {
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
      },
      tasks: [
        {
          id: "task-001",
          ordinal: 1,
          title: "Task One",
          description: "First task description",
          dependencies: [],
          acceptanceCriteria: ["AC1"],
          technicalNotes: "Some notes",
        },
      ],
    });

    const plan = mock.db.getPlan(planId);
    expect(plan).not.toBeNull();
    expect(plan!.id).toBe(planId);
    expect(plan!.summary).toBe("Test plan summary");
    expect(plan!.tasks).toHaveLength(1);
    expect(plan!.tasks[0].title).toBe("Task One");
    expect(plan!.status).toBe("ready");
  });

  it("should return null for non-existent plan", () => {
    const plan = mock.db.getPlan("non-existent-id");
    expect(plan).toBeNull();
  });

  it("should support listPlans", () => {
    mock.db.createPlan({
      id: "plan-a",
      projectPath: "/tmp/a",
      prdText: "PRD A",
      summary: "Plan A",
      technicalPack: {
        summary: "",
        architecture_notes: [],
        files_expected: [],
        dependencies: [],
        risks: [],
        assumptions: [],
        acceptance_criteria: [],
        test_strategy: [],
        effort_estimate: "",
        checklist: [],
      },
      tasks: [],
    });

    const plans = mock.db.listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].summary).toBe("Plan A");
  });

  it("should support updateTaskStatus", () => {
    mock.db.createPlan({
      id: "plan-status",
      projectPath: "/tmp/s",
      prdText: "PRD",
      summary: "Status test",
      technicalPack: {
        summary: "",
        architecture_notes: [],
        files_expected: [],
        dependencies: [],
        risks: [],
        assumptions: [],
        acceptance_criteria: [],
        test_strategy: [],
        effort_estimate: "",
        checklist: [],
      },
      tasks: [
        {
          id: "task-s1",
          ordinal: 1,
          title: "Status Task",
          description: "Desc",
          dependencies: [],
          acceptanceCriteria: [],
          technicalNotes: "",
        },
      ],
    });

    mock.db.updateTaskStatus("task-s1", "completed");

    const task = mock.db.getTask("plan-status", "task-s1");
    expect(task).not.toBeNull();
    expect(task!.status).toBe("completed");
    expect(task!.completedAt).not.toBeNull();
  });
});
