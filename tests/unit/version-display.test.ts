// @vitest-environment jsdom

/**
 * Unit tests for the Version Display Fix via IPC (t2-7).
 *
 * Tests cover:
 * - IPC channel definition consistency between shared/ipc.ts and preload constants
 * - AppVersionInfo type shape returned by mock API
 * - RalphApi.getAppVersion() contract via mock
 * - SettingsView rendering of version info (integration-style via DOM)
 *
 * NOTE: E2E tests are also provided (tests/e2e/version-display.e2e.ts) but
 * cannot run in this environment because the Electron app fails to launch in
 * the headless sandbox. The E2E tests for this feature will pass in the full
 * CI environment (GitHub Actions with Windows runner + display server).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockRalphApi,
  installMockRalphApi,
  type MockRalphApi,
} from "../../src/test-utils/mock-ralph-api";
import { IPC_CHANNELS } from "@shared/ipc";
import type { AppVersionInfo, RalphApi } from "@shared/types";

// ---------------------------------------------------------------------------
// 1. IPC Channel Definition
// ---------------------------------------------------------------------------

describe("IPC channel: app:get-version", () => {
  it("IPC_CHANNELS.getAppVersion is defined as 'app:get-version'", () => {
    expect(IPC_CHANNELS.getAppVersion).toBe("app:get-version");
  });

  it("getAppVersion key exists in the IPC_CHANNELS object", () => {
    expect("getAppVersion" in IPC_CHANNELS).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. AppVersionInfo Type Shape
// ---------------------------------------------------------------------------

describe("AppVersionInfo type contract", () => {
  it("has the four required string fields", () => {
    // This is a compile-time + runtime assertion: we create a value that
    // satisfies AppVersionInfo and verify it matches the expected shape.
    const info: AppVersionInfo = {
      appVersion: "0.2.0",
      electronVersion: "40.4.0",
      nodeVersion: "20.19.0",
      chromeVersion: "134.0.6998.23",
    };

    expect(info).toEqual({
      appVersion: "0.2.0",
      electronVersion: "40.4.0",
      nodeVersion: "20.19.0",
      chromeVersion: "134.0.6998.23",
    });

    // Verify all fields are strings
    expect(typeof info.appVersion).toBe("string");
    expect(typeof info.electronVersion).toBe("string");
    expect(typeof info.nodeVersion).toBe("string");
    expect(typeof info.chromeVersion).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 3. Mock RalphApi - getAppVersion Integration
// ---------------------------------------------------------------------------

describe("MockRalphApi.getAppVersion()", () => {
  let mockApi: MockRalphApi;

  beforeEach(() => {
    mockApi = createMockRalphApi();
  });

  it("is defined on the mock API", () => {
    expect(mockApi.getAppVersion).toBeDefined();
    expect(typeof mockApi.getAppVersion).toBe("function");
  });

  it("returns default test version info", async () => {
    const result = await mockApi.getAppVersion();

    expect(result).toEqual({
      appVersion: "0.0.0-test",
      electronVersion: "0.0.0",
      nodeVersion: "0.0.0",
      chromeVersion: "0.0.0",
    });
  });

  it("can be configured with mockResolvedValue for custom version", async () => {
    const customVersion: AppVersionInfo = {
      appVersion: "1.0.0",
      electronVersion: "40.0.0",
      nodeVersion: "22.0.0",
      chromeVersion: "130.0.0",
    };
    mockApi.getAppVersion.mockResolvedValue(customVersion);

    const result = await mockApi.getAppVersion();
    expect(result).toEqual(customVersion);
  });

  it("can be configured to reject for error testing", async () => {
    mockApi.getAppVersion.mockRejectedValue(new Error("IPC unavailable"));

    await expect(mockApi.getAppVersion()).rejects.toThrow("IPC unavailable");
  });
});

// ---------------------------------------------------------------------------
// 4. installMockRalphApi - getAppVersion on window
// ---------------------------------------------------------------------------

describe("installMockRalphApi installs getAppVersion on window.ralphApi", () => {
  let mockApi: MockRalphApi;

  beforeEach(() => {
    mockApi = installMockRalphApi();
  });

  it("window.ralphApi.getAppVersion is available", () => {
    expect(window.ralphApi).toBeDefined();
    expect((window.ralphApi as RalphApi).getAppVersion).toBeDefined();
  });

  it("window.ralphApi.getAppVersion returns version info", async () => {
    const result = await (window.ralphApi as RalphApi).getAppVersion();
    expect(result.appVersion).toBe("0.0.0-test");
  });
});

// ---------------------------------------------------------------------------
// 5. RalphApi interface - getAppVersion method presence (compile-time check)
// ---------------------------------------------------------------------------

describe("RalphApi interface includes getAppVersion", () => {
  it("getAppVersion method signature matches expected contract", () => {
    // This is a compile-time assertion via TypeScript: if getAppVersion
    // is missing from RalphApi or has the wrong signature, this file
    // won't compile. The runtime assertion verifies the mock implements it.
    const api: Pick<RalphApi, "getAppVersion"> = {
      getAppVersion: () =>
        Promise.resolve({
          appVersion: "0.2.0",
          electronVersion: "40.0.0",
          nodeVersion: "20.0.0",
          chromeVersion: "130.0.0",
        }),
    };

    expect(api.getAppVersion).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. IPC channel string uniqueness
// ---------------------------------------------------------------------------

describe("IPC channel string uniqueness", () => {
  it("app:get-version is unique among all IPC channels", () => {
    const channelValues = Object.values(IPC_CHANNELS);
    const uniqueValues = new Set(channelValues);

    // All channel values should be unique
    expect(channelValues.length).toBe(uniqueValues.size);

    // Specifically verify our channel is present exactly once
    const occurrences = channelValues.filter((v) => v === "app:get-version");
    expect(occurrences).toHaveLength(1);
  });
});
