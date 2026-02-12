/**
 * E2E test: Version display in SettingsView.
 *
 * Verifies that the Settings "About" card displays real version information
 * fetched from the main process via the app:get-version IPC channel,
 * replacing the previously hardcoded version constants.
 *
 * Covers task: Version Display Fix via IPC (t2-7)
 */

import { test, expect } from "./electron-fixture";

test.describe("Version display in Settings (t2-7)", () => {
  test("About card shows real version strings after navigation to Settings", async ({
    appPage,
    helpers,
  }) => {
    // Navigate to the Settings view via sidebar
    await helpers.clickSidebarLink("Settings");

    // Wait for the About card to be visible
    const aboutHeading = appPage.locator("text=About").first();
    await expect(aboutHeading).toBeVisible({ timeout: 10_000 });

    // Locate the aboutGrid container (parent of all label/value pairs)
    // The About card uses a grid with alternating label and value spans
    const aboutCard = appPage.locator("text=About").locator("..");

    // Verify all four version labels are present
    await expect(appPage.locator("text=App Version").first()).toBeVisible();
    await expect(appPage.locator("text=Electron").first()).toBeVisible();
    await expect(appPage.locator("text=Node.js").first()).toBeVisible();
    await expect(appPage.locator("text=Chromium").first()).toBeVisible();
  });

  test("version values are real (not loading placeholder or hardcoded)", async ({
    appPage,
    helpers,
  }) => {
    await helpers.clickSidebarLink("Settings");

    // Wait for the About section to be visible
    await expect(appPage.locator("text=About").first()).toBeVisible({ timeout: 10_000 });

    // Give the async IPC call a moment to resolve and update the DOM
    // The version info is fetched via useEffect on mount
    await appPage.waitForTimeout(1_000);

    // Collect all version value spans by evaluating the About grid structure.
    // The grid uses pairs of spans: .aboutLabel followed by .aboutValue
    // We check that no value is the loading placeholder "—" or the old hardcoded values.
    const versionValues = await appPage.evaluate(() => {
      // Find all spans that appear to be version values in the About section.
      // The About card contains a grid with label/value pairs.
      const aboutLabels = ["App Version", "Electron", "Node.js", "Chromium"];
      const results: Record<string, string> = {};

      // Find the About heading, then walk the DOM to find sibling content
      const allSpans = document.querySelectorAll("span");
      let foundAbout = false;

      for (const span of allSpans) {
        const text = span.textContent?.trim() ?? "";
        if (aboutLabels.includes(text)) {
          // The next sibling span should be the value
          const nextSibling = span.nextElementSibling;
          if (nextSibling && nextSibling.tagName === "SPAN") {
            results[text] = nextSibling.textContent?.trim() ?? "";
          }
        }
      }

      return results;
    });

    // The loading placeholder is "—" (em dash)
    const loadingPlaceholder = "\u2014";

    // Old hardcoded values from v0.1.0
    const oldHardcoded = ["0.1.0", "33.x", "20.x", "130.x"];

    // App Version should be "0.2.0" (from package.json)
    expect(versionValues["App Version"]).toBeDefined();
    expect(versionValues["App Version"]).toBe("0.2.0");
    expect(versionValues["App Version"]).not.toBe(loadingPlaceholder);

    // Electron version should be a real semver-like string (e.g., "40.4.0")
    expect(versionValues["Electron"]).toBeDefined();
    expect(versionValues["Electron"]).not.toBe(loadingPlaceholder);
    expect(versionValues["Electron"]).not.toBe("33.x");
    expect(versionValues["Electron"]).toMatch(/^\d+\.\d+/);

    // Node.js version should be a real semver-like string
    expect(versionValues["Node.js"]).toBeDefined();
    expect(versionValues["Node.js"]).not.toBe(loadingPlaceholder);
    expect(versionValues["Node.js"]).not.toBe("20.x");
    expect(versionValues["Node.js"]).toMatch(/^\d+\.\d+/);

    // Chromium version should be a real semver-like string
    expect(versionValues["Chromium"]).toBeDefined();
    expect(versionValues["Chromium"]).not.toBe(loadingPlaceholder);
    expect(versionValues["Chromium"]).not.toBe("130.x");
    expect(versionValues["Chromium"]).toMatch(/^\d+\.\d+/);
  });

  test("app version matches package.json 0.2.0", async ({
    electronApp,
    appPage,
    helpers,
  }) => {
    // Cross-verify: read the version from the Electron main process directly
    const mainProcessVersion = await electronApp.evaluate(({ app }) => {
      return app.getVersion();
    });

    expect(mainProcessVersion).toBe("0.2.0");

    // Also verify it matches what's displayed in the UI
    await helpers.clickSidebarLink("Settings");
    await expect(appPage.locator("text=About").first()).toBeVisible({ timeout: 10_000 });
    await appPage.waitForTimeout(1_000);

    const displayedVersion = await appPage.evaluate(() => {
      const spans = document.querySelectorAll("span");
      for (const span of spans) {
        if (span.textContent?.trim() === "App Version") {
          const next = span.nextElementSibling;
          if (next) return next.textContent?.trim() ?? "";
        }
      }
      return "";
    });

    expect(displayedVersion).toBe(mainProcessVersion);
  });
});
