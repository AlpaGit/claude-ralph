import { test, expect } from "./electron-fixture";

test.describe("Electron app launch", () => {
  test("app window opens and renders the main view", async ({ appPage }) => {
    // The app should have a visible window with a non-empty title or content
    const title = await appPage.title();
    // electron-vite sets the HTML title from index.html
    expect(typeof title).toBe("string");

    // The renderer should have loaded -- check that the body has content
    const body = appPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("sidebar navigation is visible", async ({ appPage }) => {
    // The AppShell sidebar should render navigation links
    const nav = appPage.locator("nav").first();
    await expect(nav).toBeVisible({ timeout: 10_000 });
  });

  test("navigating via sidebar works", async ({ appPage, helpers }) => {
    // Click the Settings nav link
    await helpers.clickSidebarLink("Settings");

    // The settings view should be visible
    const settingsContent = appPage.locator("text=Model Configuration").first();
    await expect(settingsContent).toBeVisible({ timeout: 10_000 });
  });
});
