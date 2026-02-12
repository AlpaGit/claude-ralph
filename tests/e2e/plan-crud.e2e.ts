import { test, expect } from "./electron-fixture";
import type { ElectronApplication } from "@playwright/test";

// ---------------------------------------------------------------------------
// Canned test data
// ---------------------------------------------------------------------------

/**
 * Canned TechnicalPack with 3 test tasks.
 * Used by the mocked createPlan IPC handler to bypass the Claude Agent SDK.
 */
const CANNED_TECHNICAL_PACK = {
  summary: "E2E Test Plan: Build a widget system",
  architecture_notes: ["Use modular architecture", "Event-driven communication"],
  files_expected: ["src/widget.ts", "src/widget.test.ts"],
  dependencies: ["react@19", "zustand@5"],
  risks: ["Complex state management"],
  assumptions: ["Node.js 20+ available"],
  acceptance_criteria: ["All widgets render correctly", "Tests pass"],
  test_strategy: ["Unit tests for each widget", "Integration tests for widget system"],
  effort_estimate: "2 days",
  checklist: [
    {
      id: "task-1",
      title: "Create Widget base component",
      description: "Implement the base Widget component with props interface",
      dependencies: [],
      acceptanceCriteria: ["Widget renders with default props", "Widget accepts custom children"],
      technicalNotes: "Use React.forwardRef for ref forwarding"
    },
    {
      id: "task-2",
      title: "Add Widget state management",
      description: "Implement Zustand store for widget state",
      dependencies: ["task-1"],
      acceptanceCriteria: ["Store initializes correctly", "State updates propagate to widgets"],
      technicalNotes: "Use immer middleware for immutable updates"
    },
    {
      id: "task-3",
      title: "Write Widget unit tests",
      description: "Create comprehensive test suite for Widget components",
      dependencies: ["task-1", "task-2"],
      acceptanceCriteria: ["Coverage above 80%", "All edge cases tested"],
      technicalNotes: "Use vitest with jsdom environment"
    }
  ]
};

const CANNED_PRD_TEXT = "Build a modular widget system with state management and full test coverage. The system should support custom widget types, drag-and-drop reordering, and persisted layout state.";

// ---------------------------------------------------------------------------
// Helper: seed a plan directly via IPC (bypasses Claude Agent SDK)
// ---------------------------------------------------------------------------

/**
 * Seed a plan into the app database by calling the main-process TaskRunner
 * through Electron's evaluate. This bypasses the Claude Agent SDK entirely
 * by overriding the plan:create IPC handler to insert canned data directly.
 *
 * Returns the created plan ID.
 */
async function seedPlanViaIpc(electronApp: ElectronApplication): Promise<string> {
  const planId = await electronApp.evaluate(async ({ ipcMain }) => {
    // Access the internal module registry to find the database instance.
    // The electron-vite build bundles modules, but we can use ipcMain
    // to invoke the plan:create handler. Instead, we directly create
    // the plan in the database by removing and re-registering the handler.

    // We emit a custom event to the renderer to trigger plan creation
    // via the normal IPC path. But since we cannot mock the agent service
    // from here easily, we instead directly create plan data.
    //
    // The simplest approach: invoke a special test-only handler.
    // We register it here if it does not already exist.

    const crypto = require("node:crypto");
    const planId = crypto.randomUUID();

    // Access the database through the ipcMain handler registry.
    // Electron's ipcMain.handle stores handlers internally. We can
    // call the plan:get handler to verify DB access works, then
    // directly insert via a special handler.

    // Register a test-only IPC handler that directly creates a plan
    // in the database without calling the agent service.
    return new Promise<string>((resolve, reject) => {
      // The app stores a reference to taskRunner in closure scope
      // of registerIpcHandlers. We need a different approach.
      // We'll create a one-time test handler that uses the existing
      // DB path to open a second database connection.

      const path = require("node:path");
      const os = require("node:os");
      const fs = require("node:fs");

      // Get the DB path from the environment variable used in E2E tests
      const dbPath = process.env.TEST_DB_PATH;
      if (!dbPath) {
        reject(new Error("TEST_DB_PATH not set"));
        return;
      }

      // Open a direct SQLite connection to insert test data
      // better-sqlite3 is available in the main process
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");

      const now = new Date().toISOString();
      const techPackJson = JSON.stringify({
        summary: "E2E Test Plan: Build a widget system",
        architecture_notes: ["Use modular architecture", "Event-driven communication"],
        files_expected: ["src/widget.ts", "src/widget.test.ts"],
        dependencies: ["react@19", "zustand@5"],
        risks: ["Complex state management"],
        assumptions: ["Node.js 20+ available"],
        acceptance_criteria: ["All widgets render correctly", "Tests pass"],
        test_strategy: ["Unit tests for each widget", "Integration tests for widget system"],
        effort_estimate: "2 days",
        checklist: [
          {
            id: "task-1",
            title: "Create Widget base component",
            description: "Implement the base Widget component with props interface",
            dependencies: [],
            acceptanceCriteria: ["Widget renders with default props", "Widget accepts custom children"],
            technicalNotes: "Use React.forwardRef for ref forwarding"
          },
          {
            id: "task-2",
            title: "Add Widget state management",
            description: "Implement Zustand store for widget state",
            dependencies: ["task-1"],
            acceptanceCriteria: ["Store initializes correctly", "State updates propagate to widgets"],
            technicalNotes: "Use immer middleware for immutable updates"
          },
          {
            id: "task-3",
            title: "Write Widget unit tests",
            description: "Create comprehensive test suite for Widget components",
            dependencies: ["task-1", "task-2"],
            acceptanceCriteria: ["Coverage above 80%", "All edge cases tested"],
            technicalNotes: "Use vitest with jsdom environment"
          }
        ]
      });

      try {
        db.prepare(`
          INSERT INTO plans (id, project_path, prd_text, summary, technical_pack_json, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          planId,
          "/test/project",
          "Build a modular widget system with state management and full test coverage. The system should support custom widget types, drag-and-drop reordering, and persisted layout state.",
          "E2E Test Plan: Build a widget system",
          techPackJson,
          "ready",
          now,
          now
        );

        // Insert the 3 test tasks
        const insertTask = db.prepare(`
          INSERT INTO tasks (id, plan_id, ordinal, title, description, dependencies_json, acceptance_criteria_json, technical_notes, status, created_at, updated_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `);

        insertTask.run("task-1", planId, 1, "Create Widget base component", "Implement the base Widget component with props interface", "[]", '["Widget renders with default props","Widget accepts custom children"]', "Use React.forwardRef for ref forwarding", "pending", now, now);
        insertTask.run("task-2", planId, 2, "Add Widget state management", "Implement Zustand store for widget state", '["task-1"]', '["Store initializes correctly","State updates propagate to widgets"]', "Use immer middleware for immutable updates", "pending", now, now);
        insertTask.run("task-3", planId, 3, "Write Widget unit tests", "Create comprehensive test suite for Widget components", '["task-1","task-2"]', '["Coverage above 80%","All edge cases tested"]', "Use vitest with jsdom environment", "pending", now, now);

        db.close();
        resolve(planId);
      } catch (err) {
        db.close();
        reject(err);
      }
    });
  });

  return planId;
}

/**
 * Seed a second plan for testing list count and search.
 */
async function seedSecondPlanViaIpc(electronApp: ElectronApplication): Promise<string> {
  const planId = await electronApp.evaluate(async () => {
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
      summary: "Second Test Plan: API Integration",
      architecture_notes: ["REST API design"],
      files_expected: ["src/api.ts"],
      dependencies: ["axios@1"],
      risks: ["Rate limiting"],
      assumptions: ["API keys available"],
      acceptance_criteria: ["All endpoints respond correctly"],
      test_strategy: ["Integration tests"],
      effort_estimate: "1 day",
      checklist: [
        {
          id: "api-task-1",
          title: "Create API client",
          description: "Implement the HTTP client wrapper",
          dependencies: [],
          acceptanceCriteria: ["Client sends requests correctly"],
          technicalNotes: "Use axios with interceptors"
        }
      ]
    });

    try {
      db.prepare(`
        INSERT INTO plans (id, project_path, prd_text, summary, technical_pack_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        planId,
        "/test/api-project",
        "Build an API integration layer for the backend service.",
        "Second Test Plan: API Integration",
        techPackJson,
        "ready",
        now,
        now
      );

      db.prepare(`
        INSERT INTO tasks (id, plan_id, ordinal, title, description, dependencies_json, acceptance_criteria_json, technical_notes, status, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run("api-task-1", planId, 1, "Create API client", "Implement the HTTP client wrapper", "[]", '["Client sends requests correctly"]', "Use axios with interceptors", "pending", now, now);

      db.close();
      return planId;
    } catch (err) {
      db.close();
      throw err;
    }
  });

  return planId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Plan CRUD flow", () => {
  test.describe.configure({ mode: "serial" });

  test("plan list shows empty state initially", async ({ appPage }) => {
    // Wait for the main view to load
    await appPage.waitForLoadState("domcontentloaded");

    // The plan list view should be visible (route: /)
    const heading = appPage.locator("h1").filter({ hasText: "Projects" });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Initially, the empty state should be visible since no plans exist
    const emptyState = appPage.locator("text=No plans yet");
    await expect(emptyState).toBeVisible({ timeout: 10_000 });
  });

  test("create plan: seed plan data, verify it appears in list", async ({ appPage, electronApp }) => {
    // Seed a plan directly into the database
    const planId = await seedPlanViaIpc(electronApp);
    expect(planId).toBeTruthy();

    // Navigate to the plan list (reload the page to trigger list refresh)
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    // Wait for the plan list to load
    const heading = appPage.locator("h1").filter({ hasText: "Projects" });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // The seeded plan card should appear
    const planCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Test Plan: Build a widget system" });
    await expect(planCard).toBeVisible({ timeout: 10_000 });

    // Verify the plan card shows key metadata
    await expect(planCard.locator("text=/test/")).toBeVisible();
  });

  test("view plan detail: click plan, verify sections render", async ({ appPage, electronApp }) => {
    // Seed a plan
    const planId = await seedPlanViaIpc(electronApp);

    // Navigate to the plan list
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    // Wait for plan card to appear
    const planCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Test Plan: Build a widget system" });
    await expect(planCard).toBeVisible({ timeout: 15_000 });

    // Click the plan card to navigate to detail view
    await planCard.click();

    // Wait for navigation to settle
    await appPage.waitForTimeout(500);

    // Verify the Plan Overview section renders
    const overviewTitle = appPage.locator("text=Plan Overview");
    await expect(overviewTitle).toBeVisible({ timeout: 10_000 });

    // Verify the plan summary is displayed
    const summary = appPage.locator("text=E2E Test Plan: Build a widget system");
    await expect(summary).toBeVisible({ timeout: 5_000 });

    // Verify Technical Pack section renders
    const techPackTitle = appPage.locator("text=Technical Pack");
    await expect(techPackTitle).toBeVisible({ timeout: 5_000 });

    // Verify architecture notes are present
    const archSection = appPage.locator("text=Architecture");
    await expect(archSection).toBeVisible({ timeout: 5_000 });

    // Verify the Checklist section renders
    const checklistTitle = appPage.locator("h2").filter({ hasText: "Checklist" });
    await expect(checklistTitle).toBeVisible({ timeout: 5_000 });

    // Verify all 3 task cards are present
    const taskCard1 = appPage.locator("text=Create Widget base component");
    const taskCard2 = appPage.locator("text=Add Widget state management");
    const taskCard3 = appPage.locator("text=Write Widget unit tests");

    await expect(taskCard1).toBeVisible({ timeout: 5_000 });
    await expect(taskCard2).toBeVisible({ timeout: 5_000 });
    await expect(taskCard3).toBeVisible({ timeout: 5_000 });

    // Verify the task count in the overview
    const taskCount = appPage.locator("text=Tasks: 3");
    await expect(taskCount).toBeVisible({ timeout: 5_000 });
  });

  test("archive plan: archive, verify moved to archive list", async ({ appPage, electronApp }) => {
    // Seed a plan
    const planId = await seedPlanViaIpc(electronApp);

    // Navigate to plan list
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    // Wait for plan card to appear
    const planCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Test Plan: Build a widget system" });
    await expect(planCard).toBeVisible({ timeout: 15_000 });

    // Click the Archive button on the plan card
    const archiveBtn = planCard.locator('button').filter({ hasText: "Archive" });
    await archiveBtn.click();

    // Confirmation modal should appear
    const modal = appPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Verify the modal title is "Archive Plan"
    const modalTitle = modal.locator("h2").filter({ hasText: "Archive Plan" });
    await expect(modalTitle).toBeVisible({ timeout: 3_000 });

    // Click the confirm button in the modal
    const confirmBtn = modal.locator('button').filter({ hasText: "Archive" });
    await confirmBtn.click();

    // Wait for the modal to close
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // The plan should no longer be visible in the default (non-archived) list
    await appPage.waitForTimeout(500);
    await expect(planCard).toBeHidden({ timeout: 5_000 });

    // Click "Show Archived" toggle to see archived plans
    const archiveToggle = appPage.locator('button').filter({ hasText: "Show Archived" });
    await archiveToggle.click();

    // Wait for the archived list to load
    await appPage.waitForTimeout(500);

    // The plan should now appear in the archived list
    const archivedCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Test Plan: Build a widget system" });
    await expect(archivedCard).toBeVisible({ timeout: 10_000 });

    // Verify the "Archived" badge is shown
    const archivedBadge = archivedCard.locator("text=Archived");
    await expect(archivedBadge).toBeVisible({ timeout: 3_000 });
  });

  test("unarchive plan: restore from archive", async ({ appPage, electronApp }) => {
    // Seed a plan and archive it directly in the database
    const planId = await electronApp.evaluate(async () => {
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
        summary: "Archived Plan: Restore Me",
        architecture_notes: [],
        files_expected: [],
        dependencies: [],
        risks: [],
        assumptions: [],
        acceptance_criteria: [],
        test_strategy: [],
        effort_estimate: "1 day",
        checklist: []
      });

      db.prepare(`
        INSERT INTO plans (id, project_path, prd_text, summary, technical_pack_json, status, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        planId, "/test/archived", "Test PRD for archived plan restoration.",
        "Archived Plan: Restore Me", techPackJson, "ready", now, now, now
      );

      db.close();
      return planId;
    });

    // Navigate to plan list
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    // Click "Show Archived" to see the archived plan
    const archiveToggle = appPage.locator('button').filter({ hasText: "Show Archived" });
    await expect(archiveToggle).toBeVisible({ timeout: 15_000 });
    await archiveToggle.click();

    // Wait for list to load
    await appPage.waitForTimeout(500);

    // Find the archived plan card
    const archivedCard = appPage.locator('[role="button"]').filter({ hasText: "Archived Plan: Restore Me" });
    await expect(archivedCard).toBeVisible({ timeout: 10_000 });

    // Click the "Unarchive" button on the card
    const unarchiveBtn = archivedCard.locator('button').filter({ hasText: "Unarchive" });
    await unarchiveBtn.click();

    // Confirmation modal should appear
    const modal = appPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Verify the modal title is "Unarchive Plan"
    const modalTitle = modal.locator("h2").filter({ hasText: "Unarchive Plan" });
    await expect(modalTitle).toBeVisible({ timeout: 3_000 });

    // Click the confirm button
    const confirmBtn = modal.locator('button').filter({ hasText: "Unarchive" });
    await confirmBtn.click();

    // Wait for the modal to close
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // After unarchiving, the plan should be restored.
    // The archived list may no longer show it (since it is no longer archived).
    // Toggle back to the non-archived view.
    const showingArchivedToggle = appPage.locator('button').filter({ hasText: "Showing Archived" });
    await showingArchivedToggle.click();

    // Wait for list to refresh
    await appPage.waitForTimeout(500);

    // The restored plan should now appear in the default list
    const restoredCard = appPage.locator('[role="button"]').filter({ hasText: "Archived Plan: Restore Me" });
    await expect(restoredCard).toBeVisible({ timeout: 10_000 });
  });

  test("delete plan: delete with confirmation modal, verify removed", async ({ appPage, electronApp }) => {
    // Seed a plan
    const planId = await seedPlanViaIpc(electronApp);

    // Navigate to plan list
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    // Wait for plan card to appear
    const planCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Test Plan: Build a widget system" });
    await expect(planCard).toBeVisible({ timeout: 15_000 });

    // Click the Delete button on the plan card
    const deleteBtn = planCard.locator('button').filter({ hasText: "Delete" });
    await deleteBtn.click();

    // Confirmation modal should appear
    const modal = appPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Verify the modal title is "Delete Plan"
    const modalTitle = modal.locator("h2").filter({ hasText: "Delete Plan" });
    await expect(modalTitle).toBeVisible({ timeout: 3_000 });

    // Verify the warning message is present
    const warningText = appPage.locator("text=permanently delete");
    await expect(warningText).toBeVisible({ timeout: 3_000 });

    // Click the confirm "Delete" button in the modal
    const confirmBtn = modal.locator('button').filter({ hasText: "Delete" });
    await confirmBtn.click();

    // Wait for the modal to close
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // Wait for the plan to be removed from the list
    await appPage.waitForTimeout(500);

    // The plan card should no longer be visible
    await expect(planCard).toBeHidden({ timeout: 5_000 });
  });

  test("search and filter in plan list", async ({ appPage, electronApp }) => {
    // Seed two plans
    await seedPlanViaIpc(electronApp);
    await seedSecondPlanViaIpc(electronApp);

    // Navigate to plan list
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    // Wait for both plan cards to appear
    const widgetPlan = appPage.locator('[role="button"]').filter({ hasText: "E2E Test Plan: Build a widget system" });
    const apiPlan = appPage.locator('[role="button"]').filter({ hasText: "Second Test Plan: API Integration" });
    await expect(widgetPlan).toBeVisible({ timeout: 15_000 });
    await expect(apiPlan).toBeVisible({ timeout: 10_000 });

    // Verify both plans are in the grid
    const allCards = appPage.locator('[role="button"]').filter({ hasText: /Test Plan/ });
    await expect(allCards).toHaveCount(2, { timeout: 5_000 });

    // Search for "widget" - should filter to only the widget plan
    const searchInput = appPage.locator('input[aria-label="Search plans"]');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("widget");

    // Wait for debounce (300ms) plus rendering
    await appPage.waitForTimeout(500);

    // Only the widget plan should be visible
    await expect(widgetPlan).toBeVisible({ timeout: 5_000 });
    await expect(apiPlan).toBeHidden({ timeout: 5_000 });

    // Verify the match count text
    const matchCount = appPage.locator("text=/1 of 2 plan/");
    await expect(matchCount).toBeVisible({ timeout: 3_000 });

    // Clear the search
    await searchInput.fill("");
    await appPage.waitForTimeout(500);

    // Both plans should be visible again
    await expect(widgetPlan).toBeVisible({ timeout: 5_000 });
    await expect(apiPlan).toBeVisible({ timeout: 5_000 });

    // Search by project path
    await searchInput.fill("api-project");
    await appPage.waitForTimeout(500);

    // Only the API plan should be visible
    await expect(apiPlan).toBeVisible({ timeout: 5_000 });
    await expect(widgetPlan).toBeHidden({ timeout: 5_000 });
  });

  test("delete confirmation modal: cancel does not delete", async ({ appPage, electronApp }) => {
    // Seed a plan
    await seedPlanViaIpc(electronApp);

    // Navigate to plan list
    await appPage.reload();
    await appPage.waitForLoadState("domcontentloaded");

    // Wait for plan card to appear
    const planCard = appPage.locator('[role="button"]').filter({ hasText: "E2E Test Plan: Build a widget system" });
    await expect(planCard).toBeVisible({ timeout: 15_000 });

    // Click the Delete button
    const deleteBtn = planCard.locator('button').filter({ hasText: "Delete" });
    await deleteBtn.click();

    // Modal should appear
    const modal = appPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click the Cancel button instead of confirm
    const cancelBtn = modal.locator('button').filter({ hasText: "Cancel" });
    await cancelBtn.click();

    // Modal should close
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // Plan should still be visible (not deleted)
    await expect(planCard).toBeVisible({ timeout: 5_000 });
  });
});
