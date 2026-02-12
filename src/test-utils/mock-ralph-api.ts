/**
 * Mock window.ralphApi for renderer unit tests.
 *
 * Every method on the RalphApi interface is stubbed with vi.fn() so tests can
 * assert calls and configure return values without touching real IPC.
 *
 * Usage:
 *   import { createMockRalphApi, installMockRalphApi } from "../test-utils/mock-ralph-api";
 *
 *   // Option A: just get the mock object
 *   const api = createMockRalphApi();
 *   api.getPlan.mockResolvedValue(somePlan);
 *
 *   // Option B: install on globalThis.window (for jsdom tests)
 *   const api = installMockRalphApi();
 *   // window.ralphApi is now the mock
 */

import { vi } from "vitest";
import type { RalphApi } from "@shared/types";

export type MockRalphApi = {
  [K in keyof RalphApi]: ReturnType<typeof vi.fn>;
};

/**
 * Create a mock RalphApi where every method is a vi.fn().
 * Event subscription methods (onRunEvent, onDiscoveryEvent) return a no-op
 * unsubscribe function by default.
 */
export function createMockRalphApi(): MockRalphApi {
  const noopUnsubscribe = () => {};

  return {
    createPlan: vi.fn(),
    getPlan: vi.fn(),
    listPlans: vi.fn(),
    listProjectMemory: vi.fn(),
    refreshProjectStackProfile: vi.fn(),
    deletePlan: vi.fn(),
    archivePlan: vi.fn(),
    unarchivePlan: vi.fn(),
    runTask: vi.fn(),
    runAll: vi.fn(),
    cancelRun: vi.fn(),
    retryTask: vi.fn(),
    skipTask: vi.fn(),
    setTaskPending: vi.fn(),
    approveTaskProposal: vi.fn(),
    dismissTaskProposal: vi.fn(),
    abortQueue: vi.fn(),
    startDiscovery: vi.fn(),
    continueDiscovery: vi.fn(),
    getWizardGuidance: vi.fn(),
    inferStack: vi.fn(),
    getModelConfig: vi.fn(),
    updateModelConfig: vi.fn(),
    getAppSettings: vi.fn(),
    updateAppSettings: vi.fn(),
    getDiscoverySessions: vi.fn(),
    resumeDiscoverySession: vi.fn(),
    abandonDiscoverySession: vi.fn(),
    cancelDiscovery: vi.fn(),
    getRunEvents: vi.fn(),
    onDiscoveryEvent: vi.fn().mockReturnValue(noopUnsubscribe),
    onRunEvent: vi.fn().mockReturnValue(noopUnsubscribe),
  };
}

/**
 * Install a mock RalphApi on `window.ralphApi`.
 *
 * This is intended for jsdom tests where renderer code reads from
 * `window.ralphApi`. Returns the mock for further configuration.
 */
export function installMockRalphApi(): MockRalphApi {
  const api = createMockRalphApi();
  const globalRecord = globalThis as Record<string, unknown>;
  if (!globalRecord.window || typeof globalRecord.window !== "object") {
    globalRecord.window = {};
  }
  (globalRecord.window as Record<string, unknown>).ralphApi = api;
  return api;
}
