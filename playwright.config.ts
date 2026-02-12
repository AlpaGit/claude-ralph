import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for Electron E2E tests.
 *
 * Uses the custom electron-fixture.ts for app launching and test database
 * isolation. The app must be built (electron-vite build) before running
 * E2E tests -- the test:e2e script handles this via a prebuild step.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",

  /* Maximum time one test can run */
  timeout: 60_000,

  /* Maximum time expect() can wait for a condition */
  expect: {
    timeout: 10_000
  },

  /* Run tests sequentially -- Electron does not support parallel windows well */
  fullyParallel: false,
  workers: 1,

  /* Retry failed tests once in CI */
  retries: process.env.CI ? 1 : 0,

  /* Reporter */
  reporter: process.env.CI ? "dot" : "list",

  /* No browser-based projects -- Electron fixture handles launch */
  projects: []
});
