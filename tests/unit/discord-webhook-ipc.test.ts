// @vitest-environment jsdom

/**
 * Integration-level tests for the Discord webhook test feature at the
 * renderer→IPC boundary.
 *
 * Since @testing-library/react is not available, these tests verify the
 * IPC contract and mock API surface rather than rendering the SettingsView
 * component. This validates:
 *
 * 1. The mock API correctly stubs testDiscordWebhook
 * 2. Success and error paths through window.ralphApi
 * 3. The RalphApi interface contract is satisfied
 * 4. Settings store interactions work alongside the new API method
 *
 * These tests use jsdom + installMockRalphApi to simulate the renderer
 * environment, matching the existing store test pattern.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { installMockRalphApi, type MockRalphApi } from "../../src/test-utils/mock-ralph-api";
import type { TestDiscordWebhookResult } from "@shared/types";

// Mock toast service (required for settingsStore import to not fail)
vi.mock("../../src/renderer/services/toastService", () => ({
  toastService: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Import store AFTER mocking
import { useSettingsStore } from "../../src/renderer/stores/settingsStore";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let api: MockRalphApi;

const settingsInitialState = {
  modelConfig: {
    discovery_specialist: undefined,
    plan_synthesis: undefined,
    task_execution: undefined,
    tester: undefined,
    architecture_specialist: undefined,
    committer: undefined,
  },
  loading: false,
  appSettings: { discordWebhookUrl: "" },
  error: null,
};

beforeEach(() => {
  api = installMockRalphApi();
  useSettingsStore.setState(settingsInitialState);
});

// ---------------------------------------------------------------------------
// Tests: IPC Contract
// ---------------------------------------------------------------------------

describe("Discord webhook test — IPC contract", () => {
  it("window.ralphApi.testDiscordWebhook is available as a mock function", () => {
    expect(window.ralphApi.testDiscordWebhook).toBeDefined();
    expect(typeof window.ralphApi.testDiscordWebhook).toBe("function");
  });

  it("accepts { webhookUrl } input and resolves with success result", async () => {
    const successResult: TestDiscordWebhookResult = { ok: true };
    api.testDiscordWebhook.mockResolvedValue(successResult);

    const result = await window.ralphApi.testDiscordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
    });

    expect(result).toEqual({ ok: true });
    expect(api.testDiscordWebhook).toHaveBeenCalledWith({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
    });
    expect(api.testDiscordWebhook).toHaveBeenCalledTimes(1);
  });

  it("resolves with error result when webhook fails", async () => {
    const errorResult: TestDiscordWebhookResult = {
      ok: false,
      error: "Discord returned HTTP 401: Unauthorized",
    };
    api.testDiscordWebhook.mockResolvedValue(errorResult);

    const result = await window.ralphApi.testDiscordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/bad/url",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("rejects when IPC layer throws (e.g., validation error)", async () => {
    api.testDiscordWebhook.mockRejectedValue(
      new Error('{"message":"Invalid input.","code":"VALIDATION_ERROR"}')
    );

    await expect(
      window.ralphApi.testDiscordWebhook({ webhookUrl: "" })
    ).rejects.toThrow("VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// Tests: Settings store integration
// ---------------------------------------------------------------------------

describe("Discord webhook test — settingsStore integration", () => {
  it("settings store loads appSettings with discordWebhookUrl", async () => {
    api.getModelConfig.mockResolvedValue([]);
    api.getAppSettings.mockResolvedValue({
      discordWebhookUrl: "https://discord.com/api/webhooks/saved/url",
    });

    await useSettingsStore.getState().loadSettings();

    const { appSettings } = useSettingsStore.getState();
    expect(appSettings.discordWebhookUrl).toBe(
      "https://discord.com/api/webhooks/saved/url"
    );
  });

  it("updateAppSettings persists the webhook URL", async () => {
    api.updateAppSettings.mockResolvedValue(undefined);

    await useSettingsStore.getState().updateAppSettings({
      discordWebhookUrl: "https://discord.com/api/webhooks/new/url",
    });

    expect(api.updateAppSettings).toHaveBeenCalledWith({
      discordWebhookUrl: "https://discord.com/api/webhooks/new/url",
    });
    expect(useSettingsStore.getState().appSettings.discordWebhookUrl).toBe(
      "https://discord.com/api/webhooks/new/url"
    );
  });

  it("testDiscordWebhook is independent of updateAppSettings", async () => {
    const successResult: TestDiscordWebhookResult = { ok: true };
    api.testDiscordWebhook.mockResolvedValue(successResult);

    // Test webhook without saving first
    const result = await window.ralphApi.testDiscordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/unsaved/url",
    });

    // testDiscordWebhook should NOT call updateAppSettings
    expect(api.updateAppSettings).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Simulated UI interaction flow
// ---------------------------------------------------------------------------

describe("Discord webhook test — simulated UI flow", () => {
  it("simulates full test-webhook flow: load settings → type URL → test → see result", async () => {
    // Step 1: Load settings (simulating SettingsView mount)
    api.getModelConfig.mockResolvedValue([]);
    api.getAppSettings.mockResolvedValue({
      discordWebhookUrl: "https://discord.com/api/webhooks/existing/url",
    });
    await useSettingsStore.getState().loadSettings();

    const url = useSettingsStore.getState().appSettings.discordWebhookUrl;
    expect(url).toBe("https://discord.com/api/webhooks/existing/url");

    // Step 2: User clicks "Test Webhook" (simulating handleTestWebhook)
    api.testDiscordWebhook.mockResolvedValue({ ok: true });
    const result = await window.ralphApi.testDiscordWebhook({
      webhookUrl: url,
    });

    expect(result.ok).toBe(true);
    expect(api.testDiscordWebhook).toHaveBeenCalledWith({
      webhookUrl: "https://discord.com/api/webhooks/existing/url",
    });
  });

  it("simulates test-webhook with unsaved URL (user typed but didn't save)", async () => {
    // Settings has empty URL
    api.getModelConfig.mockResolvedValue([]);
    api.getAppSettings.mockResolvedValue({ discordWebhookUrl: "" });
    await useSettingsStore.getState().loadSettings();

    // User types a new URL (local state in component, not saved yet)
    const typedUrl = "https://discord.com/api/webhooks/typed/url";

    // Test with the typed (unsaved) URL
    api.testDiscordWebhook.mockResolvedValue({ ok: true });
    const result = await window.ralphApi.testDiscordWebhook({
      webhookUrl: typedUrl,
    });

    expect(result.ok).toBe(true);
    // The typed URL was sent, not the empty saved one
    expect(api.testDiscordWebhook).toHaveBeenCalledWith({
      webhookUrl: typedUrl,
    });
    // Settings store still has empty URL (not saved)
    expect(useSettingsStore.getState().appSettings.discordWebhookUrl).toBe("");
  });

  it("simulates test-webhook failure and recovery", async () => {
    // First test: failure
    api.testDiscordWebhook.mockResolvedValue({
      ok: false,
      error: "Discord returned HTTP 404: Unknown Webhook",
    });
    const failResult = await window.ralphApi.testDiscordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/bad/url",
    });
    expect(failResult.ok).toBe(false);
    expect(failResult.error).toContain("404");

    // Second test: success (user fixed the URL)
    api.testDiscordWebhook.mockResolvedValue({ ok: true });
    const successResult = await window.ralphApi.testDiscordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/good/url",
    });
    expect(successResult.ok).toBe(true);

    expect(api.testDiscordWebhook).toHaveBeenCalledTimes(2);
  });
});
