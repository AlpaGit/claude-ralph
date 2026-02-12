import { test as base, type ElectronApplication, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import { existsSync, mkdirSync, copyFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Page helpers exposed to every E2E test via the `helpers` fixture. */
export interface PageHelpers {
  /**
   * Click a sidebar navigation link by its visible label text.
   * Waits for navigation to settle.
   */
  clickSidebarLink(label: string): Promise<void>;

  /**
   * Wait for a plan to finish loading by checking that the loading
   * indicator disappears and plan content is visible.
   */
  waitForPlanLoad(): Promise<void>;

  /**
   * Fill an input or textarea identified by its label text.
   */
  fillInput(label: string, value: string): Promise<void>;
}

/** Fixtures provided by the Electron E2E test harness. */
export interface ElectronFixtures {
  /** The launched Electron application instance. */
  electronApp: ElectronApplication;
  /** The first (main) window page. */
  appPage: Page;
  /** Convenience helpers for common page interactions. */
  helpers: PageHelpers;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Derive __dirname equivalent for ESM. */
const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

/** Root of the project (repository root). */
const PROJECT_ROOT = resolve(__dirnameESM, "..", "..");

/** Path to the built main process entry point. */
const MAIN_ENTRY = join(PROJECT_ROOT, "out", "main", "index.js");

/** Path to the migrations directory. */
const MIGRATIONS_DIR = join(PROJECT_ROOT, "resources", "migrations");

// ---------------------------------------------------------------------------
// Temp database helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory and return a fresh database path inside it.
 * Each test gets its own isolated database file so tests do not interfere.
 */
function createTempDbPath(): string {
  const dir = join(tmpdir(), "ralph-e2e-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  return join(dir, "ralph-test.sqlite");
}

/**
 * Clean up the temporary database file and its parent directory.
 */
function cleanupTempDb(dbPath: string): void {
  try {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    // Also remove WAL and SHM files if they exist (SQLite journal modes)
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    if (existsSync(walPath)) unlinkSync(walPath);
    if (existsSync(shmPath)) unlinkSync(shmPath);

    // Remove the temp directory (it should be empty now)
    const dir = resolve(dbPath, "..");
    rmdirSync(dir);
  } catch {
    // Best-effort cleanup -- temp files will be cleared by OS eventually.
  }
}

// ---------------------------------------------------------------------------
// Fixture definition
// ---------------------------------------------------------------------------

/**
 * Extended Playwright test with Electron fixtures.
 *
 * - `electronApp`: Launched Electron application with an isolated test database.
 *   Uses `TEST_DB_PATH` environment variable to direct the app to a temp DB.
 * - `appPage`: The first browser window page of the Electron app.
 * - `helpers`: Convenience methods for common UI interactions.
 *
 * The app is launched fresh for each test to ensure complete isolation.
 * The temporary database is created before launch and deleted after cleanup.
 */
export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const dbPath = createTempDbPath();

    // Ensure the app has been built
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Built main entry not found at ${MAIN_ENTRY}. ` +
          `Run "npm run build" before E2E tests.`
      );
    }

    const app = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        TEST_DB_PATH: dbPath,
        // Prevent the app from trying to auto-update or phone home
        NODE_ENV: "test"
      }
    });

    // Store the dbPath on the app object for cleanup
    (app as any).__testDbPath = dbPath;

    await use(app);

    // Cleanup
    await app.close();
    cleanupTempDb(dbPath);
  },

  appPage: async ({ electronApp }, use) => {
    // Wait for the first window to open
    const page = await electronApp.firstWindow();

    // Wait for the renderer to be fully loaded
    await page.waitForLoadState("domcontentloaded");

    await use(page);
  },

  helpers: async ({ appPage }, use) => {
    const helpers: PageHelpers = {
      async clickSidebarLink(label: string): Promise<void> {
        // Sidebar nav links contain text labels
        const link = appPage.locator(`nav >> text="${label}"`).first();
        await link.click();
        // Allow navigation to settle
        await appPage.waitForTimeout(300);
      },

      async waitForPlanLoad(): Promise<void> {
        // Wait for any loading skeleton or spinner to disappear
        const skeleton = appPage.locator('[aria-label="Loading"]');
        if (await skeleton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await skeleton.waitFor({ state: "hidden", timeout: 10_000 });
        }
      },

      async fillInput(label: string, value: string): Promise<void> {
        const input = appPage.locator(`label:has-text("${label}") + input, label:has-text("${label}") + textarea`).first();
        // If direct sibling doesn't match, try by label association
        if (!(await input.isVisible({ timeout: 500 }).catch(() => false))) {
          const byLabel = appPage.getByLabel(label);
          await byLabel.fill(value);
          return;
        }
        await input.fill(value);
      }
    };

    await use(helpers);
  }
});

export { expect } from "@playwright/test";
