import { test, expect } from "./electron-fixture";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);
const PROJECT_ROOT = resolve(__dirnameESM, "..", "..");
const MAIN_ENTRY = join(PROJECT_ROOT, "out", "main", "index.js");

// ---------------------------------------------------------------------------
// Canned discovery data
// ---------------------------------------------------------------------------

/** Canned DiscoveryInterviewState returned by the mocked startDiscovery handler. */
const CANNED_INTERVIEW_STATE_ROUND_1 = {
  sessionId: "disc-session-e2e-001",
  round: 1,
  directionSummary: "Improve API reliability and deployment confidence without breaking public endpoints.",
  inferredContext: {
    stack: "TypeScript, Node.js, Express, PostgreSQL",
    documentation: "README.md present, API docs partially generated",
    scope: "Backend API service with 40+ endpoints, CI/CD pipeline",
    painPoints: [
      "Flaky integration tests causing deployment delays",
      "No canary deployment strategy",
      "Missing API versioning"
    ],
    constraints: [
      "Must maintain backward compatibility with v1 API",
      "Zero-downtime deployment required"
    ],
    signals: [
      "Express middleware stack detected",
      "Jest test runner configured",
      "Docker compose for local dev"
    ]
  },
  questions: [
    {
      id: "q-arch-1",
      question: "What is the current API versioning strategy, if any?",
      reason: "Understanding versioning helps plan backward-compatible changes."
    },
    {
      id: "q-test-1",
      question: "Which integration tests are flaky and what do they cover?",
      reason: "Identifying flaky tests allows targeted reliability improvements."
    },
    {
      id: "q-deploy-1",
      question: "What is your current deployment pipeline (CI provider, stages)?",
      reason: "Deployment pipeline details inform the canary strategy design."
    }
  ],
  prdInputDraft: "## API Reliability Improvement Plan\n\nGoal: Improve API reliability and deployment confidence.\n\n### Scope\n- Fix flaky integration tests\n- Implement canary deployments\n- Add API versioning\n\n### Constraints\n- Maintain backward compatibility with v1\n- Zero-downtime deployments required",
  readinessScore: 45,
  missingCriticalInfo: [
    "Current test coverage metrics",
    "SLA requirements for API uptime"
  ]
};

/** Canned DiscoveryInterviewState returned by the mocked continueDiscovery handler (round 2). */
const CANNED_INTERVIEW_STATE_ROUND_2 = {
  sessionId: "disc-session-e2e-001",
  round: 2,
  directionSummary: "Improve API reliability with versioning, canary deploys, and test stabilization.",
  inferredContext: {
    stack: "TypeScript, Node.js, Express, PostgreSQL, Docker",
    documentation: "README.md present, OpenAPI spec partially complete",
    scope: "Backend API service with 40+ endpoints, CI/CD via GitHub Actions",
    painPoints: [
      "3 flaky tests in payment module cause 30% of pipeline failures",
      "No canary deployment strategy",
      "API versioning only via URL prefix, inconsistently applied"
    ],
    constraints: [
      "Must maintain backward compatibility with v1 API",
      "Zero-downtime deployment required",
      "GitHub Actions budget limited to 2000 minutes/month"
    ],
    signals: [
      "Express middleware stack detected",
      "Jest test runner with 72% coverage",
      "Docker compose for local dev",
      "GitHub Actions CI detected"
    ]
  },
  questions: [
    {
      id: "q-perf-1",
      question: "What are the current p95 latency targets for critical endpoints?",
      reason: "Latency targets inform performance testing requirements."
    },
    {
      id: "q-monitor-1",
      question: "What monitoring and alerting tools are currently in use?",
      reason: "Monitoring setup affects the canary rollback automation design."
    }
  ],
  prdInputDraft: "## API Reliability Improvement Plan\n\nGoal: Improve API reliability and deployment confidence.\n\n### Current State\n- 40+ endpoints on Express/Node.js/TypeScript\n- 72% test coverage, 3 flaky tests in payment module\n- GitHub Actions CI, no canary strategy\n- URL-prefix versioning, inconsistently applied\n\n### Scope\n- Stabilize flaky payment tests\n- Implement canary deployment via GitHub Actions\n- Standardize API versioning across all endpoints\n- Add deployment confidence checks\n\n### Constraints\n- Maintain v1 backward compatibility\n- Zero-downtime deployments\n- 2000 min/month GitHub Actions budget\n\n### Success Criteria\n- Pipeline failure rate < 5%\n- Canary catches breaking changes before full rollout\n- All endpoints consistently versioned",
  readinessScore: 72,
  missingCriticalInfo: [
    "Performance SLA targets"
  ]
};

/** Specialist names for simulated progress events. */
const SPECIALIST_NAMES = [
  "Architecture Analyst",
  "Codebase Scanner",
  "Test Coverage Reviewer",
  "Deployment Strategist",
  "Dependency Auditor"
];

// ---------------------------------------------------------------------------
// Helper: mock discovery IPC handlers with canned data and event emission
// ---------------------------------------------------------------------------

/**
 * Replace the real discovery IPC handlers in the main process with mocked
 * versions that return canned data and emit synthetic discovery events.
 *
 * This avoids calling the Claude Agent SDK while still exercising the full
 * renderer-side discovery flow (store, view, event handling).
 */
async function mockDiscoveryHandlers(
  electronApp: ElectronApplication,
  options: {
    round1State: typeof CANNED_INTERVIEW_STATE_ROUND_1;
    round2State: typeof CANNED_INTERVIEW_STATE_ROUND_2;
    specialistNames: string[];
  }
): Promise<void> {
  await electronApp.evaluate(async (_electron, args) => {
    const { ipcMain, BrowserWindow } = require("electron");

    // Remove existing discovery handlers so we can re-register them
    ipcMain.removeHandler("discovery:start");
    ipcMain.removeHandler("discovery:continue");
    ipcMain.removeHandler("discovery:sessions");
    ipcMain.removeHandler("discovery:resume");
    ipcMain.removeHandler("discovery:abandon");
    ipcMain.removeHandler("discovery:cancel");

    // Helper to emit a discovery event to the renderer
    function emitDiscoveryEvent(event: Record<string, unknown>): void {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send("discovery:event", event);
      }
    }

    // Helper to generate a UUID
    function uuid(): string {
      return require("node:crypto").randomUUID();
    }

    // ---- discovery:start ----
    ipcMain.handle("discovery:start", async (_event: unknown, rawInput: unknown) => {
      const input = rawInput as { projectPath: string; seedSentence: string; additionalContext: string };
      const sessionId = args.round1State.sessionId;

      // Emit status event: starting
      emitDiscoveryEvent({
        id: uuid(),
        ts: new Date().toISOString(),
        sessionId,
        type: "status",
        level: "info",
        message: "Discovery interview started."
      });

      // Emit specialist progress events with small delays
      for (const name of args.specialistNames) {
        emitDiscoveryEvent({
          id: uuid(),
          ts: new Date().toISOString(),
          sessionId,
          type: "agent",
          level: "info",
          message: `Starting specialist agent: ${name}`,
          agent: name
        });

        // Emit a log event for each specialist
        emitDiscoveryEvent({
          id: uuid(),
          ts: new Date().toISOString(),
          sessionId,
          type: "log",
          level: "info",
          message: `${name} is analyzing the project...`
        });

        // Emit completion for each specialist
        emitDiscoveryEvent({
          id: uuid(),
          ts: new Date().toISOString(),
          sessionId,
          type: "agent",
          level: "info",
          message: `Completed specialist agent: ${name} (3.2s)`,
          agent: name
        });
      }

      // Emit completed event
      emitDiscoveryEvent({
        id: uuid(),
        ts: new Date().toISOString(),
        sessionId,
        type: "completed",
        level: "info",
        message: "Discovery analysis complete. Questions generated."
      });

      // Also persist the session in the DB for the resume test
      const dbPath = process.env.TEST_DB_PATH;
      if (dbPath) {
        const Database = require("better-sqlite3");
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        const now = new Date().toISOString();
        try {
          db.prepare(`
            INSERT OR REPLACE INTO discovery_sessions (
              id, project_path, seed_sentence, additional_context,
              answer_history_json, round_number, latest_state_json,
              status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            sessionId,
            input.projectPath || "",
            input.seedSentence,
            input.additionalContext || "",
            "[]",
            1,
            JSON.stringify(args.round1State),
            "active",
            now,
            now
          );
        } catch {
          // Ignore DB errors in mock
        } finally {
          db.close();
        }
      }

      return args.round1State;
    });

    // ---- discovery:continue ----
    ipcMain.handle("discovery:continue", async (_event: unknown, rawInput: unknown) => {
      const input = rawInput as { sessionId: string; answers: Array<{ questionId: string; answer: string }> };
      const sessionId = input.sessionId;

      // Emit events for round 2
      emitDiscoveryEvent({
        id: uuid(),
        ts: new Date().toISOString(),
        sessionId,
        type: "status",
        level: "info",
        message: "Processing answers and refining analysis..."
      });

      for (const name of args.specialistNames.slice(0, 3)) {
        emitDiscoveryEvent({
          id: uuid(),
          ts: new Date().toISOString(),
          sessionId,
          type: "agent",
          level: "info",
          message: `Starting specialist agent: ${name}`,
          agent: name
        });
        emitDiscoveryEvent({
          id: uuid(),
          ts: new Date().toISOString(),
          sessionId,
          type: "agent",
          level: "info",
          message: `Completed specialist agent: ${name} (2.1s)`,
          agent: name
        });
      }

      emitDiscoveryEvent({
        id: uuid(),
        ts: new Date().toISOString(),
        sessionId,
        type: "completed",
        level: "info",
        message: "Discovery refinement complete."
      });

      // Update the session in the DB with round 2 state and answer history
      const dbPath = process.env.TEST_DB_PATH;
      if (dbPath) {
        const Database = require("better-sqlite3");
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        const now = new Date().toISOString();
        try {
          db.prepare(`
            UPDATE discovery_sessions SET
              round_number = 2,
              latest_state_json = ?,
              answer_history_json = ?,
              updated_at = ?
            WHERE id = ?
          `).run(
            JSON.stringify(args.round2State),
            JSON.stringify(input.answers),
            now,
            sessionId
          );
        } catch {
          // Ignore DB errors in mock
        } finally {
          db.close();
        }
      }

      return args.round2State;
    });

    // ---- discovery:sessions ----
    ipcMain.handle("discovery:sessions", async () => {
      const dbPath = process.env.TEST_DB_PATH;
      if (!dbPath) return [];
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      try {
        const rows = db.prepare(
          "SELECT id, project_path, seed_sentence, round_number, latest_state_json, updated_at FROM discovery_sessions WHERE status = 'active' ORDER BY updated_at DESC"
        ).all() as Array<{
          id: string;
          project_path: string;
          seed_sentence: string;
          round_number: number;
          latest_state_json: string;
          updated_at: string;
        }>;
        return rows.map((row) => {
          let readinessScore = 0;
          try {
            const state = JSON.parse(row.latest_state_json);
            readinessScore = state.readinessScore ?? 0;
          } catch { /* ignore */ }
          return {
            id: row.id,
            projectPath: row.project_path,
            seedSentence: row.seed_sentence,
            roundNumber: row.round_number,
            readinessScore,
            updatedAt: row.updated_at
          };
        });
      } catch {
        return [];
      } finally {
        db.close();
      }
    });

    // ---- discovery:resume ----
    ipcMain.handle("discovery:resume", async (_event: unknown, rawInput: unknown) => {
      const input = rawInput as { sessionId: string };
      const dbPath = process.env.TEST_DB_PATH;
      if (!dbPath) throw new Error("TEST_DB_PATH not set");
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      try {
        const row = db.prepare(
          "SELECT latest_state_json FROM discovery_sessions WHERE id = ? LIMIT 1"
        ).get(input.sessionId) as { latest_state_json: string } | undefined;
        if (!row) throw new Error("Session not found");
        return JSON.parse(row.latest_state_json);
      } finally {
        db.close();
      }
    });

    // ---- discovery:abandon ----
    ipcMain.handle("discovery:abandon", async (_event: unknown, rawInput: unknown) => {
      const input = rawInput as { sessionId: string };
      const dbPath = process.env.TEST_DB_PATH;
      if (!dbPath) return;
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      try {
        db.prepare("UPDATE discovery_sessions SET status = 'abandoned', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), input.sessionId);
      } catch { /* ignore */ }
      finally { db.close(); }
    });

    // ---- discovery:cancel ----
    ipcMain.handle("discovery:cancel", async (_event: unknown, rawInput: unknown) => {
      return { cancelled: true };
    });
  }, {
    round1State: options.round1State,
    round2State: options.round2State,
    specialistNames: options.specialistNames
  });
}

// ---------------------------------------------------------------------------
// Helper: seed a discovery session directly in the DB (for resume test)
// ---------------------------------------------------------------------------

/**
 * Seed an active discovery session directly into the database.
 * This simulates a session that was started and left incomplete.
 */
async function seedDiscoverySession(
  electronApp: ElectronApplication,
  options: {
    sessionId: string;
    seedSentence: string;
    interviewState: typeof CANNED_INTERVIEW_STATE_ROUND_1;
    answerHistory?: Array<{ questionId: string; answer: string }>;
  }
): Promise<void> {
  await electronApp.evaluate(async (_electron, args) => {
    const dbPath = process.env.TEST_DB_PATH;
    if (!dbPath) throw new Error("TEST_DB_PATH not set");

    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT OR REPLACE INTO discovery_sessions (
          id, project_path, seed_sentence, additional_context,
          answer_history_json, round_number, latest_state_json,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        args.sessionId,
        "",
        args.seedSentence,
        "",
        JSON.stringify(args.answerHistory ?? []),
        args.interviewState.round,
        JSON.stringify(args.interviewState),
        "active",
        now,
        now
      );
    } finally {
      db.close();
    }
  }, {
    sessionId: options.sessionId,
    seedSentence: options.seedSentence,
    interviewState: options.interviewState,
    answerHistory: options.answerHistory ?? []
  });
}

// ---------------------------------------------------------------------------
// Tests: Full Discovery Interview Flow
// ---------------------------------------------------------------------------

test.describe("Discovery interview flow", () => {
  test.describe.configure({ mode: "serial" });

  test("enter seed sentence, start discovery, verify specialist progress, verify questions rendered", async ({ appPage, electronApp, helpers }) => {
    // Mock the discovery IPC handlers
    await mockDiscoveryHandlers(electronApp, {
      round1State: CANNED_INTERVIEW_STATE_ROUND_1,
      round2State: CANNED_INTERVIEW_STATE_ROUND_2,
      specialistNames: SPECIALIST_NAMES
    });

    // Navigate to Discovery view
    await helpers.clickSidebarLink("Discovery");

    // Verify the Discovery view heading is visible
    const heading = appPage.locator("h2").filter({ hasText: "Interactive PRD Discovery" });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Enter the seed sentence in the Goal Sentence textarea
    const seedInput = appPage.getByLabel("Goal Sentence");
    await expect(seedInput).toBeVisible({ timeout: 5_000 });
    await seedInput.fill("Improve API reliability and deployment confidence without breaking public endpoints.");

    // Click Start Discovery Interview button
    const startBtn = appPage.locator("button").filter({ hasText: "Start Discovery Interview" });
    await expect(startBtn).toBeVisible({ timeout: 5_000 });
    await startBtn.click();

    // Wait for the AI Feedback panel to appear (shows during loading and after events arrive)
    const feedbackPanel = appPage.locator("h3").filter({ hasText: "AI Feedback (Live)" });
    await expect(feedbackPanel).toBeVisible({ timeout: 15_000 });

    // Wait for discovery to complete and specialist progress to render
    // The specialist tracker should show completed specialists
    // Since the mock returns immediately, the loading state may be brief.
    // Wait for the interview output to be ready.

    // Verify "Discovery Status" card appears (shows after interview state arrives)
    const statusCard = appPage.locator("h3").filter({ hasText: "Discovery Status" });
    await expect(statusCard).toBeVisible({ timeout: 15_000 });

    // Verify round number is 1
    const roundText = appPage.locator("text=Round: 1");
    await expect(roundText).toBeVisible({ timeout: 5_000 });

    // Verify readiness score is shown
    const readinessText = appPage.locator("text=Readiness: 45%");
    await expect(readinessText).toBeVisible({ timeout: 5_000 });

    // Verify the "Early Discovery" badge (readinessScore < 60)
    const earlyBadge = appPage.locator("text=Early Discovery");
    await expect(earlyBadge).toBeVisible({ timeout: 5_000 });

    // Verify Inferred Context card renders with stack info
    const contextCard = appPage.locator("h3").filter({ hasText: "Inferred Context" });
    await expect(contextCard).toBeVisible({ timeout: 5_000 });

    const stackText = appPage.locator("text=TypeScript, Node.js, Express, PostgreSQL");
    await expect(stackText).toBeVisible({ timeout: 5_000 });

    // Verify pain points are listed
    const painPointText = appPage.locator("text=Flaky integration tests causing deployment delays");
    await expect(painPointText).toBeVisible({ timeout: 5_000 });

    // Verify the Detailed Questions section renders with 3 questions
    const questionsCard = appPage.locator("h3").filter({ hasText: "Detailed Questions" });
    await expect(questionsCard).toBeVisible({ timeout: 5_000 });

    // Verify each question text is visible
    const q1 = appPage.locator("text=What is the current API versioning strategy, if any?");
    const q2 = appPage.locator("text=Which integration tests are flaky and what do they cover?");
    const q3 = appPage.locator("text=What is your current deployment pipeline (CI provider, stages)?");
    await expect(q1).toBeVisible({ timeout: 5_000 });
    await expect(q2).toBeVisible({ timeout: 5_000 });
    await expect(q3).toBeVisible({ timeout: 5_000 });

    // Verify the "Why this matters" reason text is visible for at least one question
    const reasonText = appPage.locator("text=Understanding versioning helps plan backward-compatible changes.");
    await expect(reasonText).toBeVisible({ timeout: 5_000 });

    // Verify missing critical info section
    const missingCard = appPage.locator("h3").filter({ hasText: "Missing Critical Info" });
    await expect(missingCard).toBeVisible({ timeout: 5_000 });
    const missingItem = appPage.locator("text=Current test coverage metrics");
    await expect(missingItem).toBeVisible({ timeout: 5_000 });

    // Verify Discovery Output Ready card
    const outputReady = appPage.locator("h3").filter({ hasText: "Discovery Output Ready" });
    await expect(outputReady).toBeVisible({ timeout: 5_000 });

    // Verify specialist events were logged in the feedback panel
    // Check that the log box contains specialist agent mentions
    const logBox = appPage.locator("pre").filter({ hasText: "Architecture Analyst" });
    await expect(logBox).toBeVisible({ timeout: 5_000 });
  });

  test("answer questions, continue discovery, verify refined output", async ({ appPage, electronApp, helpers }) => {
    // Mock the discovery IPC handlers
    await mockDiscoveryHandlers(electronApp, {
      round1State: CANNED_INTERVIEW_STATE_ROUND_1,
      round2State: CANNED_INTERVIEW_STATE_ROUND_2,
      specialistNames: SPECIALIST_NAMES
    });

    // Navigate to Discovery view
    await helpers.clickSidebarLink("Discovery");
    const heading = appPage.locator("h2").filter({ hasText: "Interactive PRD Discovery" });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Start discovery
    const seedInput = appPage.getByLabel("Goal Sentence");
    await seedInput.fill("Improve API reliability and deployment confidence without breaking public endpoints.");
    const startBtn = appPage.locator("button").filter({ hasText: "Start Discovery Interview" });
    await startBtn.click();

    // Wait for questions to render
    const questionsCard = appPage.locator("h3").filter({ hasText: "Detailed Questions" });
    await expect(questionsCard).toBeVisible({ timeout: 15_000 });

    // Fill in answers to all 3 questions
    // The questions have textarea inputs following the question text
    // Each question item has a UTextArea within it
    const questionItems = appPage.locator("li").filter({ has: appPage.locator("textarea") });
    const textareas = questionItems.locator("textarea");
    const textareaCount = await textareas.count();

    // We expect at least 3 textareas for the 3 questions
    expect(textareaCount).toBeGreaterThanOrEqual(3);

    // Fill answers
    await textareas.nth(0).fill("We use URL prefix versioning (/v1/) but it is not consistently applied across all endpoints.");
    await textareas.nth(1).fill("The payment processing tests (test-payments.spec.ts) are flaky due to race conditions in the mock payment gateway.");
    await textareas.nth(2).fill("GitHub Actions with 3 stages: lint+typecheck, test, deploy to AWS ECS.");

    // Verify the answers-this-round counter updates
    const answeredCount = appPage.locator("text=Questions answered this round: 3/3");
    await expect(answeredCount).toBeVisible({ timeout: 5_000 });

    // Click "Submit Answers And Continue" button
    const continueBtn = appPage.locator("button").filter({ hasText: "Submit Answers And Continue" });
    await expect(continueBtn).toBeVisible({ timeout: 5_000 });
    await continueBtn.click();

    // Wait for round 2 state to arrive
    const round2Text = appPage.locator("text=Round: 2");
    await expect(round2Text).toBeVisible({ timeout: 15_000 });

    // Verify the readiness score increased to 72%
    const readiness72 = appPage.locator("text=Readiness: 72%");
    await expect(readiness72).toBeVisible({ timeout: 5_000 });

    // Verify "Needs More Detail" badge (readinessScore >= 60 && < 85)
    const needsMoreBadge = appPage.locator("text=Needs More Detail");
    await expect(needsMoreBadge).toBeVisible({ timeout: 5_000 });

    // Verify refined direction summary
    const refinedDirection = appPage.locator("text=Improve API reliability with versioning, canary deploys, and test stabilization.");
    await expect(refinedDirection).toBeVisible({ timeout: 5_000 });

    // Verify new questions from round 2
    const perfQuestion = appPage.locator("text=What are the current p95 latency targets for critical endpoints?");
    await expect(perfQuestion).toBeVisible({ timeout: 5_000 });

    const monitorQuestion = appPage.locator("text=What monitoring and alerting tools are currently in use?");
    await expect(monitorQuestion).toBeVisible({ timeout: 5_000 });

    // Verify the updated inferred context (now includes Docker and GitHub Actions)
    const updatedStack = appPage.locator("text=TypeScript, Node.js, Express, PostgreSQL, Docker");
    await expect(updatedStack).toBeVisible({ timeout: 5_000 });

    // Verify the PRD preview is available
    const prdToggle = appPage.locator("summary").filter({ hasText: "Preview Generated PRD Input" });
    await expect(prdToggle).toBeVisible({ timeout: 5_000 });

    // Expand the PRD preview
    await prdToggle.click();
    await appPage.waitForTimeout(300);

    // Verify PRD preview content contains key sections
    const prdPreview = appPage.locator("pre").filter({ hasText: "API Reliability Improvement Plan" });
    await expect(prdPreview).toBeVisible({ timeout: 5_000 });

    // Verify PRD preview contains specific content from round 2
    const prdContent = appPage.locator("pre").filter({ hasText: "Pipeline failure rate < 5%" });
    await expect(prdContent).toBeVisible({ timeout: 5_000 });
  });

  test("verify PRD preview and Use as Plan Input action", async ({ appPage, electronApp, helpers }) => {
    // Mock the discovery IPC handlers
    await mockDiscoveryHandlers(electronApp, {
      round1State: CANNED_INTERVIEW_STATE_ROUND_1,
      round2State: CANNED_INTERVIEW_STATE_ROUND_2,
      specialistNames: SPECIALIST_NAMES
    });

    // Navigate to Discovery view and start discovery
    await helpers.clickSidebarLink("Discovery");
    const heading = appPage.locator("h2").filter({ hasText: "Interactive PRD Discovery" });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    const seedInput = appPage.getByLabel("Goal Sentence");
    await seedInput.fill("Improve API reliability and deployment confidence without breaking public endpoints.");
    const startBtn = appPage.locator("button").filter({ hasText: "Start Discovery Interview" });
    await startBtn.click();

    // Wait for interview state to arrive
    const statusCard = appPage.locator("h3").filter({ hasText: "Discovery Status" });
    await expect(statusCard).toBeVisible({ timeout: 15_000 });

    // Verify "Use as Plan Input" button is visible
    const usePlanBtn = appPage.locator("button").filter({ hasText: "Use as Plan Input" }).first();
    await expect(usePlanBtn).toBeVisible({ timeout: 5_000 });

    // Verify "Copy PRD Input" button is visible
    const copyBtn = appPage.locator("button").filter({ hasText: "Copy PRD Input" }).first();
    await expect(copyBtn).toBeVisible({ timeout: 5_000 });

    // Click "Use as Plan Input" to navigate to plan list with PRD text
    await usePlanBtn.click();

    // Should navigate to the plan list view (/)
    await appPage.waitForTimeout(500);
    const plansHeading = appPage.locator("h1").filter({ hasText: "Plans" });
    await expect(plansHeading).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Tests: Resume Discovery Flow
// ---------------------------------------------------------------------------

test.describe("Discovery resume flow", () => {
  test("resume: seed active session, reopen app, verify resume prompt, resume session", async ({}, testInfo) => {
    // This test manages its own app lifecycle for close/reopen testing.
    // We cannot use the fixture's electronApp since we need to restart.

    const dbDir = join(tmpdir(), "ralph-e2e-resume-" + randomUUID());
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, "ralph-resume-test.sqlite");

    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Built main entry not found at ${MAIN_ENTRY}. Run "npm run build" before E2E tests.`
      );
    }

    // --- First launch: start discovery session and close ---

    const app1 = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, TEST_DB_PATH: dbPath, NODE_ENV: "test" }
    });

    const page1 = await app1.firstWindow();
    await page1.waitForLoadState("domcontentloaded");

    // Wait for initial rendering
    const heading1 = page1.locator("h1").filter({ hasText: "Plans" });
    await expect(heading1).toBeVisible({ timeout: 15_000 });

    // Mock discovery handlers for app1
    await app1.evaluate(async (_electron, args) => {
      const { ipcMain, BrowserWindow } = require("electron");

      // Remove existing handlers
      try { ipcMain.removeHandler("discovery:start"); } catch {}
      try { ipcMain.removeHandler("discovery:continue"); } catch {}
      try { ipcMain.removeHandler("discovery:sessions"); } catch {}
      try { ipcMain.removeHandler("discovery:resume"); } catch {}
      try { ipcMain.removeHandler("discovery:abandon"); } catch {}
      try { ipcMain.removeHandler("discovery:cancel"); } catch {}

      function emitDiscoveryEvent(event: Record<string, unknown>): void {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send("discovery:event", event);
        }
      }

      function uuid(): string {
        return require("node:crypto").randomUUID();
      }

      ipcMain.handle("discovery:start", async (_event: unknown, rawInput: unknown) => {
        const input = rawInput as { projectPath: string; seedSentence: string; additionalContext: string };
        const state = args.interviewState;

        emitDiscoveryEvent({
          id: uuid(), ts: new Date().toISOString(), sessionId: state.sessionId,
          type: "status", level: "info", message: "Discovery interview started."
        });

        // Persist the session
        const Database = require("better-sqlite3");
        const db = new Database(args.dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        const now = new Date().toISOString();
        try {
          db.prepare(`
            INSERT OR REPLACE INTO discovery_sessions (
              id, project_path, seed_sentence, additional_context,
              answer_history_json, round_number, latest_state_json,
              status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(state.sessionId, "", input.seedSentence, "", "[]", 1,
            JSON.stringify(state), "active", now, now);
        } catch {} finally { db.close(); }

        return state;
      });

      ipcMain.handle("discovery:sessions", async () => {
        const Database = require("better-sqlite3");
        const db = new Database(args.dbPath);
        db.pragma("journal_mode = WAL");
        try {
          const rows = db.prepare(
            "SELECT id, project_path, seed_sentence, round_number, latest_state_json, updated_at FROM discovery_sessions WHERE status = 'active' ORDER BY updated_at DESC"
          ).all() as Array<{ id: string; project_path: string; seed_sentence: string; round_number: number; latest_state_json: string; updated_at: string }>;
          return rows.map((row) => {
            let readinessScore = 0;
            try { const s = JSON.parse(row.latest_state_json); readinessScore = s.readinessScore ?? 0; } catch {}
            return { id: row.id, projectPath: row.project_path, seedSentence: row.seed_sentence, roundNumber: row.round_number, readinessScore, updatedAt: row.updated_at };
          });
        } catch { return []; }
        finally { db.close(); }
      });

      ipcMain.handle("discovery:resume", async (_event: unknown, rawInput: unknown) => {
        const input = rawInput as { sessionId: string };
        const Database = require("better-sqlite3");
        const db = new Database(args.dbPath);
        db.pragma("journal_mode = WAL");
        try {
          const row = db.prepare("SELECT latest_state_json FROM discovery_sessions WHERE id = ? LIMIT 1")
            .get(input.sessionId) as { latest_state_json: string } | undefined;
          if (!row) throw new Error("Session not found");
          return JSON.parse(row.latest_state_json);
        } finally { db.close(); }
      });

      ipcMain.handle("discovery:abandon", async (_event: unknown, rawInput: unknown) => {
        const input = rawInput as { sessionId: string };
        const Database = require("better-sqlite3");
        const db = new Database(args.dbPath);
        db.pragma("journal_mode = WAL");
        try {
          db.prepare("UPDATE discovery_sessions SET status = 'abandoned', updated_at = ? WHERE id = ?")
            .run(new Date().toISOString(), input.sessionId);
        } catch {} finally { db.close(); }
      });

      ipcMain.handle("discovery:cancel", async () => ({ cancelled: true }));
      ipcMain.handle("discovery:continue", async () => args.interviewState);
    }, {
      interviewState: CANNED_INTERVIEW_STATE_ROUND_1,
      dbPath
    });

    // Navigate to Discovery and start a session
    const discoveryLink1 = page1.locator(`nav >> text="Discovery"`).first();
    await discoveryLink1.click();
    await page1.waitForTimeout(300);

    const discoveryHeading1 = page1.locator("h2").filter({ hasText: "Interactive PRD Discovery" });
    await expect(discoveryHeading1).toBeVisible({ timeout: 15_000 });

    const seedInput1 = page1.getByLabel("Goal Sentence");
    await seedInput1.fill("Improve API reliability and deployment confidence without breaking public endpoints.");

    const startBtn1 = page1.locator("button").filter({ hasText: "Start Discovery Interview" });
    await startBtn1.click();

    // Wait for the session to be created (interview state arrives)
    const statusCard1 = page1.locator("h3").filter({ hasText: "Discovery Status" });
    await expect(statusCard1).toBeVisible({ timeout: 15_000 });

    // Verify the session is active with questions
    const roundText1 = page1.locator("text=Round: 1");
    await expect(roundText1).toBeVisible({ timeout: 5_000 });

    // Close the first app instance (simulating app close)
    await app1.close();

    // --- Second launch: reopen with same DB, verify resume prompt ---

    const app2 = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, TEST_DB_PATH: dbPath, NODE_ENV: "test" }
    });

    const page2 = await app2.firstWindow();
    await page2.waitForLoadState("domcontentloaded");

    // Wait for initial rendering
    const heading2 = page2.locator("h1").filter({ hasText: "Plans" });
    await expect(heading2).toBeVisible({ timeout: 15_000 });

    // Mock discovery handlers for app2
    await app2.evaluate(async (_electron, args) => {
      const { ipcMain } = require("electron");

      try { ipcMain.removeHandler("discovery:start"); } catch {}
      try { ipcMain.removeHandler("discovery:continue"); } catch {}
      try { ipcMain.removeHandler("discovery:sessions"); } catch {}
      try { ipcMain.removeHandler("discovery:resume"); } catch {}
      try { ipcMain.removeHandler("discovery:abandon"); } catch {}
      try { ipcMain.removeHandler("discovery:cancel"); } catch {}

      ipcMain.handle("discovery:sessions", async () => {
        const Database = require("better-sqlite3");
        const db = new Database(args.dbPath);
        db.pragma("journal_mode = WAL");
        try {
          const rows = db.prepare(
            "SELECT id, project_path, seed_sentence, round_number, latest_state_json, updated_at FROM discovery_sessions WHERE status = 'active' ORDER BY updated_at DESC"
          ).all() as Array<{ id: string; project_path: string; seed_sentence: string; round_number: number; latest_state_json: string; updated_at: string }>;
          return rows.map((row) => {
            let readinessScore = 0;
            try { const s = JSON.parse(row.latest_state_json); readinessScore = s.readinessScore ?? 0; } catch {}
            return { id: row.id, projectPath: row.project_path, seedSentence: row.seed_sentence, roundNumber: row.round_number, readinessScore, updatedAt: row.updated_at };
          });
        } catch { return []; }
        finally { db.close(); }
      });

      ipcMain.handle("discovery:resume", async (_event: unknown, rawInput: unknown) => {
        const input = rawInput as { sessionId: string };
        const Database = require("better-sqlite3");
        const db = new Database(args.dbPath);
        db.pragma("journal_mode = WAL");
        try {
          const row = db.prepare("SELECT latest_state_json FROM discovery_sessions WHERE id = ? LIMIT 1")
            .get(input.sessionId) as { latest_state_json: string } | undefined;
          if (!row) throw new Error("Session not found");
          return JSON.parse(row.latest_state_json);
        } finally { db.close(); }
      });

      ipcMain.handle("discovery:abandon", async (_event: unknown, rawInput: unknown) => {
        const input = rawInput as { sessionId: string };
        const Database = require("better-sqlite3");
        const db = new Database(args.dbPath);
        db.pragma("journal_mode = WAL");
        try {
          db.prepare("UPDATE discovery_sessions SET status = 'abandoned', updated_at = ? WHERE id = ?")
            .run(new Date().toISOString(), input.sessionId);
        } catch {} finally { db.close(); }
      });

      ipcMain.handle("discovery:cancel", async () => ({ cancelled: true }));
      ipcMain.handle("discovery:start", async () => args.interviewState);
      ipcMain.handle("discovery:continue", async () => args.interviewState);
    }, {
      interviewState: CANNED_INTERVIEW_STATE_ROUND_1,
      dbPath
    });

    // Navigate to Discovery view -- this should trigger checkActiveSessions
    const discoveryLink2 = page2.locator(`nav >> text="Discovery"`).first();
    await discoveryLink2.click();
    await page2.waitForTimeout(300);

    const discoveryHeading2 = page2.locator("h2").filter({ hasText: "Interactive PRD Discovery" });
    await expect(discoveryHeading2).toBeVisible({ timeout: 15_000 });

    // The resume dialog should appear because there is an active session
    const resumeDialog = page2.locator('[role="dialog"][aria-label="Resume discovery session"]');
    await expect(resumeDialog).toBeVisible({ timeout: 10_000 });

    // Verify the resume dialog title
    const resumeTitle = resumeDialog.locator("h3").filter({ hasText: "Active Discovery Session Found" });
    await expect(resumeTitle).toBeVisible({ timeout: 5_000 });

    // Verify session info is displayed (seed sentence truncated or full)
    const sessionSeed = resumeDialog.locator("text=Improve API reliability");
    await expect(sessionSeed).toBeVisible({ timeout: 5_000 });

    // Verify round and readiness info
    const sessionRound = resumeDialog.locator("text=Round 1");
    await expect(sessionRound).toBeVisible({ timeout: 5_000 });
    const sessionReadiness = resumeDialog.locator("text=Readiness: 45%");
    await expect(sessionReadiness).toBeVisible({ timeout: 5_000 });

    // Click "Resume" button in the dialog
    const resumeBtn = resumeDialog.locator("button").filter({ hasText: "Resume" });
    await expect(resumeBtn).toBeVisible({ timeout: 5_000 });
    await resumeBtn.click();

    // Wait for the resume dialog to close
    await expect(resumeDialog).toBeHidden({ timeout: 10_000 });

    // Verify the interview state is restored -- Discovery Status card should appear
    const statusCard2 = page2.locator("h3").filter({ hasText: "Discovery Status" });
    await expect(statusCard2).toBeVisible({ timeout: 15_000 });

    // Verify round 1 data is restored
    const roundText2 = page2.locator("text=Round: 1");
    await expect(roundText2).toBeVisible({ timeout: 5_000 });

    // Verify questions are rendered from the restored session
    const restoredQ1 = page2.locator("text=What is the current API versioning strategy, if any?");
    await expect(restoredQ1).toBeVisible({ timeout: 5_000 });

    const restoredQ2 = page2.locator("text=Which integration tests are flaky and what do they cover?");
    await expect(restoredQ2).toBeVisible({ timeout: 5_000 });

    // Verify inferred context is restored
    const restoredStack = page2.locator("text=TypeScript, Node.js, Express, PostgreSQL");
    await expect(restoredStack).toBeVisible({ timeout: 5_000 });

    // Verify the seed sentence input was populated from the resumed session
    const seedInput2 = page2.getByLabel("Goal Sentence");
    await expect(seedInput2).toHaveValue(
      "Improve API reliability and deployment confidence without breaking public endpoints.",
      { timeout: 5_000 }
    );

    // Clean up: close the second app
    await app2.close();

    // Cleanup temp DB files
    const fs = await import("node:fs");
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
      if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
      fs.rmdirSync(dbDir);
    } catch {
      // Best-effort cleanup
    }
  });
});
