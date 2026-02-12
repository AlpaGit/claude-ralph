// @vitest-environment jsdom

/**
 * Smoke test for the mock RalphApi in a jsdom environment.
 * Verifies that createMockRalphApi and installMockRalphApi work correctly,
 * and that the jsdom test environment annotation is functioning.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMockRalphApi, installMockRalphApi } from "../../test-utils/mock-ralph-api";

describe("mock-ralph-api (jsdom)", () => {
  it("should create a mock with all RalphApi methods", () => {
    const api = createMockRalphApi();

    // Verify that key methods exist and are callable vi.fn() stubs
    expect(api.createPlan).toBeDefined();
    expect(api.getPlan).toBeDefined();
    expect(api.listPlans).toBeDefined();
    expect(api.runTask).toBeDefined();
    expect(api.cancelRun).toBeDefined();
    expect(api.startDiscovery).toBeDefined();
    expect(api.onRunEvent).toBeDefined();
    expect(api.onDiscoveryEvent).toBeDefined();
  });

  it("should allow configuring mock return values", async () => {
    const api = createMockRalphApi();

    api.getPlan.mockResolvedValue({
      id: "mock-plan",
      summary: "Mock plan",
      status: "ready",
      tasks: [],
      runs: []
    });

    const plan = await api.getPlan("mock-plan");
    expect(plan.id).toBe("mock-plan");
    expect(api.getPlan).toHaveBeenCalledWith("mock-plan");
  });

  it("should return a no-op unsubscribe for event subscriptions", () => {
    const api = createMockRalphApi();

    const unsub = api.onRunEvent(() => {});
    expect(typeof unsub).toBe("function");
    // Should not throw
    unsub();
  });

  describe("installMockRalphApi", () => {
    beforeEach(() => {
      installMockRalphApi();
    });

    it("should install mock on window.ralphApi", () => {
      expect(window.ralphApi).toBeDefined();
      expect(typeof (window.ralphApi as Record<string, unknown>).createPlan).toBe("function");
    });
  });

  it("should confirm jsdom environment is active", () => {
    // In jsdom, document should be available
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
  });
});
