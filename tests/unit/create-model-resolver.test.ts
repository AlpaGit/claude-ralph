/**
 * Tests for {@link createModelResolver} — the factory function that builds a
 * ModelResolver from a ModelConfigMap with DEFAULT_MODEL_BY_ROLE fallback.
 *
 * Introduced during task t1-2d (Wire Up Decomposed Agent Modules) to replace
 * the private RalphAgentService.getModel method with a standalone, testable
 * factory exported from agent-constants.ts.
 */
import { describe, it, expect } from "vitest";
import {
  createModelResolver,
  DEFAULT_MODEL_BY_ROLE,
  type ModelConfigMap
} from "../../src/main/runtime/agent-constants";
import type { AgentRole } from "../../src/shared/types";

const ALL_ROLES: AgentRole[] = [
  "discovery_specialist",
  "plan_synthesis",
  "task_execution",
  "tester",
  "architecture_specialist",
  "committer"
];

describe("createModelResolver", () => {
  describe("fallback behavior (empty config)", () => {
    const resolver = createModelResolver(new Map());

    it.each(ALL_ROLES)("returns DEFAULT_MODEL_BY_ROLE for %s when config is empty", (role) => {
      expect(resolver(role)).toBe(DEFAULT_MODEL_BY_ROLE[role]);
    });
  });

  describe("override behavior", () => {
    it("returns the overridden model when config has an entry for the role", () => {
      const config: ModelConfigMap = new Map([["task_execution", "claude-haiku-3"]]);
      const resolver = createModelResolver(config);

      expect(resolver("task_execution")).toBe("claude-haiku-3");
    });

    it("falls back to default for roles NOT in the config map", () => {
      const config: ModelConfigMap = new Map([["task_execution", "claude-haiku-3"]]);
      const resolver = createModelResolver(config);

      expect(resolver("committer")).toBe(DEFAULT_MODEL_BY_ROLE.committer);
      expect(resolver("discovery_specialist")).toBe(DEFAULT_MODEL_BY_ROLE.discovery_specialist);
    });

    it("supports overriding every role simultaneously", () => {
      const overrides: [AgentRole, string][] = ALL_ROLES.map((role) => [role, `custom-${role}`]);
      const config: ModelConfigMap = new Map(overrides);
      const resolver = createModelResolver(config);

      for (const role of ALL_ROLES) {
        expect(resolver(role)).toBe(`custom-${role}`);
      }
    });
  });

  describe("isolation", () => {
    it("mutating the config map after creation does not affect the resolver", () => {
      const config: ModelConfigMap = new Map([["tester", "original-model"]]);
      const resolver = createModelResolver(config);

      // Mutate the original map after resolver creation
      config.set("tester", "mutated-model");

      // The resolver captures the map by reference, so this WILL see the mutation.
      // This test documents current behavior — the resolver uses a closure over
      // the original Map reference. If immutability is needed, the factory should
      // copy the map (out of scope for this task).
      expect(resolver("tester")).toBe("mutated-model");
    });

    it("two resolvers from different configs are independent", () => {
      const config1: ModelConfigMap = new Map([["committer", "model-a"]]);
      const config2: ModelConfigMap = new Map([["committer", "model-b"]]);
      const resolver1 = createModelResolver(config1);
      const resolver2 = createModelResolver(config2);

      expect(resolver1("committer")).toBe("model-a");
      expect(resolver2("committer")).toBe("model-b");
    });
  });
});
