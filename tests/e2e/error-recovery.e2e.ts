import { test, expect } from "./electron-fixture";
import type { ElectronApplication, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helper: seed a plan with 3 tasks into the test database
// ---------------------------------------------------------------------------

/**
 * Seed a plan with 3 tasks (task-2 depends on task-1, task-3 depends on task-1 and task-2).
 * Returns the planId and all 3 taskIds.
 */
async function seedPlanWith3Tasks(electronApp: ElectronApplication): Promise<{
  planId: string;
  taskIds: [string, string, string];
}> {
  return await electronApp.evaluate(async () => {
    const crypto = require("node:crypto");
    const planId = crypto.randomUUID();

    const dbPath = process.env.TEST_DB_PATH;
    if (!dbPath) throw new Error("TEST_DB_PATH not set");

    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const now = new Date().toISOString();
    const techPackJson = JSON.stringify({
      summary: "E2E Error Recovery Test Plan",
      architecture_notes: ["Modular architecture"],
      files_expected: ["src/a.ts", "src/b.ts", "src/c.ts"],
      dependencies: ["react@19"],
      risks: ["Task failure scenarios"],
      assumptions: ["Node.js 20+ available"],
      acceptance_criteria: ["All recovery flows work"],
      test_strategy: ["E2E tests for error recovery"],
      effort_estimate: "1 day",
      checklist: [
        {
          id: "err-task-1",
          title: "Set up project scaffold",
          description: "Create initial project structure",
          dependencies: [],
          acceptanceCriteria: ["Project structure created"],
          technicalNotes: "Use standard layout"
        },
        {
          id: "err-task-2",
          title: "Implement core logic",
          description: "Build the core business logic module",
          dependencies: ["err-task-1"],
          acceptanceCriteria: ["Core module works"],
          technicalNotes: "Follow TDD approach"
        },
        {
          id: "err-task-3",
          title: "Write integration tests",
          description: "Create integration test suite",
          dependencies: ["err-task-1", "err-task-2"],
          acceptanceCriteria: ["Tests pass"],
          technicalNotes: "Use vitest"
        }
      ]
    });

    try {
      db.prepare(`
        INSERT INTO plans (id, project_path, prd_text, summary, technical_pack_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        planId,
        "/test/error-recovery",
        "Build a system with error recovery testing.",
        "E2E Error Recovery Test Plan",
        techPackJson,
        "ready",
        now,
        now
      );

      const insertTask = db.prepare(`
        INSERT INTO tasks (id, plan_id, ordinal, title, description, dependencies_json, acceptance_criteria_json, technical_notes, status, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `);

      insertTask.run("err-task-1", planId, 1, "Set up project scaffold", "Create initial project structure", "[]", '["Project structure created"]', "Use standard layout", "pending", now, now);
      insertTask.run("err-task-2", planId, 2, "Implement core logic", "Build the core business logic module", '["err-task-1"]', '["Core module works"]', "Follow TDD approach", "pending", now, now);
      insertTask.run("err-task-3", planId, 3, "Write integration tests", "Create integration test suite", '["err-task-1","err-task-2"]', '["Tests pass"]', "Use vitest", "pending", now, now);

      db.close();
      return { planId, taskIds: ["err-task-1", "err-task-2", "err-task-3"] as [string, string, string] };
    } catch (err) {
      db.close();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Helper: seed a completed run for a task
// ---------------------------------------------------------------------------

async function seedCompletedRun(
  electronApp: ElectronApplication,
  planId: string,
  taskId: string
): Promise<string> {
  return await electronApp.evaluate(async (_electron, args) => {
    const crypto = require("node:crypto");
    const runId = crypto.randomUUID();

    const dbPath = process.env.TEST_DB_PATH;
    if (!dbPath) throw new Error("TEST_DB_PATH not set");

    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO runs (id, plan_id, task_id, session_id, status, started_at, ended_at, duration_ms, total_cost_usd, result_text, stop_reason, error_text, retry_count)
        VALUES (?, ?, ?, NULL, 'completed', ?, ?, 1200, 0.003, 'Task completed.', 'end_turn', NULL, 0)
      `).run(runId, args.planId, args.taskId, now, now);

      db.prepare("UPDATE tasks SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ?")
        .run(now, now, args.taskId);

      db.prepare("UPDATE plans SET status = 'running', updated_at = ? WHERE id = ?")
        .run(now, args.planId);

      // Emit completion event to renderer
      const { BrowserWindow } = require("electron");
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send("run:event", {
          id: crypto.randomUUID(),
          ts: now,
          runId,
          planId: args.planId,
          taskId: args.taskId,
          type: "completed",
          level: "info",
          payload: { stopReason: "end_turn", totalCostUsd: 0.003, durationMs: 1200 }
        });
        windows[0].webContents.send("run:event", {
          id: crypto.randomUUID(),
          ts: now,
          runId,
          planId: args.planId,
          taskId: args.taskId,
          type: "task_status",
          level: "info",
          payload: { status: "completed" }
        });
      }

      db.close();
      return runId;
    } catch (err) {
      db.close();
      throw err;
    }
  }, { planId, taskId });
}

// ---------------------------------------------------------------------------
// Helper: seed a failed run for a task
// ---------------------------------------------------------------------------

async function seedFailedRun(
  electronApp: ElectronApplication,
  planId: string,
  taskId: string,
  errorText: string = "SDK execution error: model overloaded",
  retryCount: number = 0
): Promise<string> {
  return await electronApp.evaluate(async (_electron, args) => {
    const crypto = require("node:crypto");
    const runId = crypto.randomUUID();

    const dbPath = process.env.TEST_DB_PATH;
    if (!dbPath) throw new Error("TEST_DB_PATH not set");

    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO runs (id, plan_id, task_id, session_id, status, started_at, ended_at, duration_ms, total_cost_usd, result_text, stop_reason, error_text, retry_count)
        VALUES (?, ?, ?, NULL, 'failed', ?, ?, 800, NULL, NULL, NULL, ?, ?)
      `).run(runId, args.planId, args.taskId, now, now, args.errorText, args.retryCount);

      db.prepare("UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(now, args.taskId);

      db.prepare("UPDATE plans SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(now, args.planId);

      // Emit failure event to renderer
      const { BrowserWindow } = require("electron");
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send("run:event", {
          id: crypto.randomUUID(),
          ts: now,
          runId,
          planId: args.planId,
          taskId: args.taskId,
          type: "task_status",
          level: "error",
          payload: { status: "failed" }
        });
        windows[0].webContents.send("run:event", {
          id: crypto.randomUUID(),
          ts: now,
          runId,
          planId: args.planId,
          taskId: args.taskId,
          type: "failed",
          level: "error",
          payload: { error: args.errorText }
        });
      }

      db.close();
      return runId;
    } catch (err) {
      db.close();
      throw err;
    }
  }, { planId, taskId, errorText, retryCount });
}

// ---------------------------------------------------------------------------
// Helper: update task status directly in DB and emit event
// ---------------------------------------------------------------------------

async function updateTaskStatusInDb(
  electronApp: ElectronApplication,
  planId: string,
  taskId: string,
  status: string
): Promise<void> {
  await electronApp.evaluate(async (_electron, args) => {
    const crypto = require("node:crypto");
    const dbPath = process.env.TEST_DB_PATH;
    if (!dbPath) throw new Error("TEST_DB_PATH not set");

    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const now = new Date().toISOString();

    try {
      db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
        .run(args.status, now, args.taskId);

      if (args.status === "skipped") {
        // Check if all tasks are done
        const allTasks = db.prepare("SELECT status FROM tasks WHERE plan_id = ?").all(args.planId) as Array<{ status: string }>;
        const allDone = allTasks.every((t: { status: string }) => t.status === "completed" || t.status === "skipped");
        const newPlanStatus = allDone ? "completed" : "ready";
        db.prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?")
          .run(newPlanStatus, now, args.planId);
      }

      // Emit event to renderer
      const { BrowserWindow } = require("electron");
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send("run:event", {
          id: crypto.randomUUID(),
          ts: now,
          runId: "",
          planId: args.planId,
          taskId: args.taskId,
          type: "task_status",
          level: "info",
          payload: { status: args.status, message: `Task ${args.taskId} ${args.status}.` }
        });
      }

      db.close();
    } catch (err) {
      db.close();
      throw err;
    }
  }, { planId, taskId, status });
}

// ---------------------------------------------------------------------------
// Helper: navigate to plan detail
// ---------------------------------------------------------------------------

async function navigateToPlanDetail(appPage: Page, planSummary: string): Promise<void> {
  await appPage.reload();
  await appPage.waitForLoadState("domcontentloaded");

  const planCard = appPage.locator('[role="button"]').filter({ hasText: planSummary });
  await expect(planCard).toBeVisible({ timeout: 15_000 });
  await planCard.click();
  await appPage.waitForTimeout(500);

  const overviewTitle = appPage.locator("text=Plan Overview");
  await expect(overviewTitle).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Tests: Error Recovery
// ---------------------------------------------------------------------------

test.describe("Error recovery flow", () => {
  test.describe.configure({ mode: "serial" });

  test("task failure shows Retry, Skip buttons on failed task card", async ({ appPage, electronApp }) => {
    // Seed plan with 3 tasks, complete task-1, fail task-2
    const { planId, taskIds } = await seedPlanWith3Tasks(electronApp);

    // Complete task-1
    await seedCompletedRun(electronApp, planId, taskIds[0]);

    // Fail task-2
    await seedFailedRun(electronApp, planId, taskIds[1], "SDK error: API rate limit exceeded");

    // Navigate to plan detail
    await navigateToPlanDetail(appPage, "E2E Error Recovery Test Plan");

    // Wait for events to propagate
    await appPage.waitForTimeout(1500);

    // Verify task-1 shows completed
    const task1Card = appPage.locator("text=Set up project scaffold").first();
    await expect(task1Card).toBeVisible({ timeout: 5_000 });

    // Verify task-2 shows failed and is auto-expanded (failed tasks auto-expand)
    const failedPill = appPage.locator("text=failed").first();
    await expect(failedPill).toBeVisible({ timeout: 10_000 });

    // Verify Retry button appears for the failed task
    const retryBtn = appPage.locator("button").filter({ hasText: "Retry" });
    await expect(retryBtn).toBeVisible({ timeout: 5_000 });

    // Verify Skip button appears for the failed task
    const skipBtn = appPage.locator("button").filter({ hasText: "Skip" });
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
  });

  test("skip failed task: task becomes skipped, pending tasks remain visible", async ({ appPage, electronApp }) => {
    // Seed plan with 3 tasks, complete task-1, fail task-2
    const { planId, taskIds } = await seedPlanWith3Tasks(electronApp);
    await seedCompletedRun(electronApp, planId, taskIds[0]);
    await seedFailedRun(electronApp, planId, taskIds[1], "Build compilation error");

    // Navigate to plan detail
    await navigateToPlanDetail(appPage, "E2E Error Recovery Test Plan");
    await appPage.waitForTimeout(1500);

    // Verify the Skip button is visible
    const skipBtn = appPage.locator("button").filter({ hasText: "Skip" });
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });

    // Directly update the task to skipped status in DB (simulating what skipTask IPC does)
    // since clicking Skip would invoke the real IPC which requires the TaskRunner
    await updateTaskStatusInDb(electronApp, planId, taskIds[1], "skipped");

    // Wait for plan reload
    await appPage.waitForTimeout(1500);

    // Reload the plan detail to reflect DB changes
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    const planCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Error Recovery Test Plan" });
    await expect(planCard).toBeVisible({ timeout: 15_000 });
    await planCard.click();
    await appPage.waitForTimeout(500);

    // Verify task-2 is now shown as skipped
    const skippedPill = appPage.locator("text=skipped").first();
    await expect(skippedPill).toBeVisible({ timeout: 10_000 });

    // Verify task-3 (Write integration tests) is still visible and pending
    const task3Card = appPage.locator("text=Write integration tests").first();
    await expect(task3Card).toBeVisible({ timeout: 5_000 });
  });

  test("retry creates new run: seed retry run with context, verify new run appears", async ({ appPage, electronApp }) => {
    // Seed plan with 3 tasks, complete task-1, fail task-2
    const { planId, taskIds } = await seedPlanWith3Tasks(electronApp);
    await seedCompletedRun(electronApp, planId, taskIds[0]);
    await seedFailedRun(electronApp, planId, taskIds[1], "Compilation failed: missing import");

    // Navigate to plan detail
    await navigateToPlanDetail(appPage, "E2E Error Recovery Test Plan");
    await appPage.waitForTimeout(1500);

    // Verify the Retry button is visible for the failed task
    const retryBtn = appPage.locator("button").filter({ hasText: "Retry" });
    await expect(retryBtn).toBeVisible({ timeout: 5_000 });

    // Simulate a retry: create a new run with retry_count = 1 that succeeds
    // This simulates what retryTask in TaskRunner does
    const retryRunId = await electronApp.evaluate(async (_electron, args) => {
      const crypto = require("node:crypto");
      const runId = crypto.randomUUID();

      const dbPath = process.env.TEST_DB_PATH;
      if (!dbPath) throw new Error("TEST_DB_PATH not set");

      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");

      const now = new Date().toISOString();

      try {
        // Create a retry run with retry_count = 1
        db.prepare(`
          INSERT INTO runs (id, plan_id, task_id, session_id, status, started_at, ended_at, duration_ms, total_cost_usd, result_text, stop_reason, error_text, retry_count)
          VALUES (?, ?, ?, NULL, 'completed', ?, ?, 2000, 0.005, 'Retry succeeded. Task completed on second attempt.', 'end_turn', NULL, 1)
        `).run(runId, args.planId, args.taskId, now, now);

        // Update task to completed
        db.prepare("UPDATE tasks SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ?")
          .run(now, now, args.taskId);

        // Update plan status
        db.prepare("UPDATE plans SET status = 'running', updated_at = ? WHERE id = ?")
          .run(now, args.planId);

        // Emit events
        const { BrowserWindow } = require("electron");
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          const win = windows[0];
          win.webContents.send("run:event", {
            id: crypto.randomUUID(),
            ts: now,
            runId,
            planId: args.planId,
            taskId: args.taskId,
            type: "started",
            level: "info",
            payload: { message: "Task retry #1 started.", taskTitle: "Implement core logic", retryCount: 1 }
          });
          win.webContents.send("run:event", {
            id: crypto.randomUUID(),
            ts: now,
            runId,
            planId: args.planId,
            taskId: args.taskId,
            type: "task_status",
            level: "info",
            payload: { status: "completed" }
          });
          win.webContents.send("run:event", {
            id: crypto.randomUUID(),
            ts: now,
            runId,
            planId: args.planId,
            taskId: args.taskId,
            type: "completed",
            level: "info",
            payload: { stopReason: "end_turn", totalCostUsd: 0.005, durationMs: 2000 }
          });
        }

        db.close();
        return runId;
      } catch (err) {
        db.close();
        throw err;
      }
    }, { planId, taskId: taskIds[1] });

    // Wait for events to propagate
    await appPage.waitForTimeout(1500);

    // Verify task-2 is now completed after retry
    // Reload the page to reflect fresh data
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    const planCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Error Recovery Test Plan" });
    await expect(planCard).toBeVisible({ timeout: 15_000 });
    await planCard.click();
    await appPage.waitForTimeout(500);

    // Wait for plan detail to render
    const overviewTitle = appPage.locator("text=Plan Overview");
    await expect(overviewTitle).toBeVisible({ timeout: 10_000 });

    // Verify task-2 now shows completed (it was previously failed, now completed after retry)
    // Look for the "Implement core logic" task card with a completed status
    const task2Title = appPage.locator("text=Implement core logic").first();
    await expect(task2Title).toBeVisible({ timeout: 5_000 });

    // There should be at least 2 completed pills (task-1 and task-2)
    const completedPills = appPage.locator("text=completed");
    const completedCount = await completedPills.count();
    expect(completedCount).toBeGreaterThanOrEqual(2);
  });

  test("abort queue: stops queue execution, plan returns to ready state", async ({ appPage, electronApp }) => {
    // Seed plan with 3 tasks and set plan to "running" to simulate queue execution
    const { planId, taskIds } = await seedPlanWith3Tasks(electronApp);

    // Complete task-1 and set task-2 to in_progress to simulate active queue
    await seedCompletedRun(electronApp, planId, taskIds[0]);

    // Set task-2 to in_progress with a running state
    await electronApp.evaluate(async (_electron, args) => {
      const crypto = require("node:crypto");
      const dbPath = process.env.TEST_DB_PATH;
      if (!dbPath) throw new Error("TEST_DB_PATH not set");

      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");

      const now = new Date().toISOString();
      const runId = crypto.randomUUID();

      try {
        // Create an in_progress run for task-2
        db.prepare(`
          INSERT INTO runs (id, plan_id, task_id, session_id, status, started_at, ended_at, duration_ms, total_cost_usd, result_text, stop_reason, error_text, retry_count)
          VALUES (?, ?, ?, NULL, 'in_progress', ?, NULL, NULL, NULL, NULL, NULL, NULL, 0)
        `).run(runId, args.planId, args.taskIds[1], now);

        db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?")
          .run(now, args.taskIds[1]);

        db.prepare("UPDATE plans SET status = 'running', updated_at = ? WHERE id = ?")
          .run(now, args.planId);

        // Emit events
        const { BrowserWindow } = require("electron");
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send("run:event", {
            id: crypto.randomUUID(),
            ts: now,
            runId,
            planId: args.planId,
            taskId: args.taskIds[1],
            type: "started",
            level: "info",
            payload: { message: "Task execution started.", taskTitle: "Implement core logic" }
          });
          windows[0].webContents.send("run:event", {
            id: crypto.randomUUID(),
            ts: now,
            runId,
            planId: args.planId,
            taskId: args.taskIds[1],
            type: "task_status",
            level: "info",
            payload: { status: "in_progress" }
          });
        }

        db.close();
      } catch (err) {
        db.close();
        throw err;
      }
    }, { planId, taskIds });

    // Navigate to plan detail
    await navigateToPlanDetail(appPage, "E2E Error Recovery Test Plan");
    await appPage.waitForTimeout(1500);

    // Verify the plan shows as running
    // The task-2 should show in_progress
    const inProgressPill = appPage.locator("text=in_progress").first();
    await expect(inProgressPill).toBeVisible({ timeout: 10_000 });

    // Now simulate abort by resetting plan/task state
    await electronApp.evaluate(async (_electron, args) => {
      const crypto = require("node:crypto");
      const dbPath = process.env.TEST_DB_PATH;
      if (!dbPath) throw new Error("TEST_DB_PATH not set");

      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");

      const now = new Date().toISOString();

      try {
        // Cancel any in_progress runs
        db.prepare("UPDATE runs SET status = 'cancelled', ended_at = ?, error_text = 'Queue aborted by user' WHERE plan_id = ? AND status = 'in_progress'")
          .run(now, args.planId);

        // Reset in_progress tasks to pending
        db.prepare("UPDATE tasks SET status = 'pending', updated_at = ? WHERE plan_id = ? AND status = 'in_progress'")
          .run(now, args.planId);

        // Set plan back to ready
        db.prepare("UPDATE plans SET status = 'ready', updated_at = ? WHERE id = ?")
          .run(now, args.planId);

        // Emit abort event
        const { BrowserWindow } = require("electron");
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send("run:event", {
            id: crypto.randomUUID(),
            ts: now,
            runId: "",
            planId: args.planId,
            taskId: "",
            type: "info",
            level: "info",
            payload: { message: "Queue execution aborted by user." }
          });
          // Emit task_status for task-2 going back to pending
          windows[0].webContents.send("run:event", {
            id: crypto.randomUUID(),
            ts: now,
            runId: "",
            planId: args.planId,
            taskId: args.taskIds[1],
            type: "task_status",
            level: "info",
            payload: { status: "pending" }
          });
        }

        db.close();
      } catch (err) {
        db.close();
        throw err;
      }
    }, { planId, taskIds });

    // Wait for events and reload
    await appPage.waitForTimeout(1500);

    // Reload to see updated state
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    const planCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Error Recovery Test Plan" });
    await expect(planCard).toBeVisible({ timeout: 15_000 });
    await planCard.click();
    await appPage.waitForTimeout(500);

    const overviewTitle = appPage.locator("text=Plan Overview");
    await expect(overviewTitle).toBeVisible({ timeout: 10_000 });

    // Verify task-2 is back to pending after abort
    // Look for pending pills - task-2 and task-3 should both be pending
    const pendingPills = appPage.locator("text=pending");
    const pendingCount = await pendingPills.count();
    expect(pendingCount).toBeGreaterThanOrEqual(2);

    // Verify task-1 is still completed
    const completedPills = appPage.locator("text=completed");
    const completedCount = await completedPills.count();
    expect(completedCount).toBeGreaterThanOrEqual(1);
  });

  test("queue with 3 tasks where task 2 fails: task-1 completes, task-2 fails, task-3 remains pending", async ({ appPage, electronApp }) => {
    // Seed plan with 3 tasks
    const { planId, taskIds } = await seedPlanWith3Tasks(electronApp);

    // Complete task-1
    await seedCompletedRun(electronApp, planId, taskIds[0]);

    // Fail task-2
    await seedFailedRun(electronApp, planId, taskIds[1], "Test compilation failed: undefined variable");

    // Navigate to plan detail
    await navigateToPlanDetail(appPage, "E2E Error Recovery Test Plan");
    await appPage.waitForTimeout(1500);

    // Verify task-1 shows completed
    const completedPill = appPage.locator("text=completed").first();
    await expect(completedPill).toBeVisible({ timeout: 10_000 });

    // Verify task-2 shows failed
    const failedPill = appPage.locator("text=failed").first();
    await expect(failedPill).toBeVisible({ timeout: 10_000 });

    // Verify task-3 remains pending (queue stopped at task-2 failure)
    const pendingPill = appPage.locator("text=pending").first();
    await expect(pendingPill).toBeVisible({ timeout: 10_000 });

    // Verify all 3 tasks are present
    const task1 = appPage.locator("text=Set up project scaffold").first();
    const task2 = appPage.locator("text=Implement core logic").first();
    const task3 = appPage.locator("text=Write integration tests").first();

    await expect(task1).toBeVisible({ timeout: 5_000 });
    await expect(task2).toBeVisible({ timeout: 5_000 });
    await expect(task3).toBeVisible({ timeout: 5_000 });

    // Verify Retry and Skip buttons are visible for the failed task-2
    const retryBtn = appPage.locator("button").filter({ hasText: "Retry" });
    await expect(retryBtn).toBeVisible({ timeout: 5_000 });

    const skipBtn = appPage.locator("button").filter({ hasText: "Skip" });
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
  });
});
