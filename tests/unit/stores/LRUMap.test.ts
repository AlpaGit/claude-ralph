/**
 * Unit tests for LRUMap — lightweight LRU cache used by runStore.
 *
 * Tests cover:
 * - Basic get/set/has/delete/clear operations
 * - LRU eviction order (least-recently-used evicted first)
 * - Recency promotion on get and set (existing key)
 * - Dispose callback invocation on eviction, delete, and clear
 * - Capacity boundary (size never exceeds capacity)
 * - Edge cases (capacity = 1, iterator order)
 */

import { describe, it, expect, vi } from "vitest";
import { LRUMap } from "../../../src/renderer/stores/LRUMap";

describe("LRUMap", () => {
  // ── Constructor ────────────────────────────────────────

  describe("constructor", () => {
    it("should create an empty map with the given capacity", () => {
      const lru = new LRUMap<string, number>(5);
      expect(lru.size).toBe(0);
      expect(lru.capacity).toBe(5);
    });

    it("should throw for capacity < 1", () => {
      expect(() => new LRUMap<string, number>(0)).toThrow(RangeError);
      expect(() => new LRUMap<string, number>(-1)).toThrow(RangeError);
    });
  });

  // ── Basic operations ───────────────────────────────────

  describe("set / get / has", () => {
    it("should store and retrieve a value", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("a", 1);

      expect(lru.get("a")).toBe(1);
      expect(lru.has("a")).toBe(true);
      expect(lru.size).toBe(1);
    });

    it("should return undefined for missing keys", () => {
      const lru = new LRUMap<string, number>(3);
      expect(lru.get("missing")).toBeUndefined();
      expect(lru.has("missing")).toBe(false);
    });

    it("should overwrite an existing key", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("a", 1);
      lru.set("a", 99);

      expect(lru.get("a")).toBe(99);
      expect(lru.size).toBe(1);
    });

    it("should store multiple entries up to capacity", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);

      expect(lru.size).toBe(3);
      expect(lru.get("a")).toBe(1);
      expect(lru.get("b")).toBe(2);
      expect(lru.get("c")).toBe(3);
    });
  });

  // ── Eviction ───────────────────────────────────────────

  describe("eviction", () => {
    it("should evict LRU entry when capacity is exceeded", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      lru.set("d", 4); // should evict "a"

      expect(lru.size).toBe(3);
      expect(lru.has("a")).toBe(false);
      expect(lru.get("a")).toBeUndefined();
      expect(lru.get("b")).toBe(2);
      expect(lru.get("c")).toBe(3);
      expect(lru.get("d")).toBe(4);
    });

    it("should promote key on get, evicting a different LRU entry", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);

      // Access "a" to promote it — now "b" is the LRU
      lru.get("a");

      lru.set("d", 4); // should evict "b" (not "a")

      expect(lru.has("a")).toBe(true);
      expect(lru.has("b")).toBe(false);
      expect(lru.has("c")).toBe(true);
      expect(lru.has("d")).toBe(true);
    });

    it("should promote key on set (update), evicting a different LRU entry", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);

      // Update "a" in place — promotes it; now "b" is the LRU
      lru.set("a", 10);

      lru.set("d", 4); // should evict "b"

      expect(lru.has("a")).toBe(true);
      expect(lru.get("a")).toBe(10);
      expect(lru.has("b")).toBe(false);
    });

    it("should handle capacity = 1 correctly", () => {
      const lru = new LRUMap<string, number>(1);
      lru.set("a", 1);
      expect(lru.get("a")).toBe(1);

      lru.set("b", 2); // evicts "a"
      expect(lru.size).toBe(1);
      expect(lru.has("a")).toBe(false);
      expect(lru.get("b")).toBe(2);
    });

    it("should never exceed capacity", () => {
      const lru = new LRUMap<string, number>(5);
      for (let i = 0; i < 100; i++) {
        lru.set(`key-${i}`, i);
      }
      expect(lru.size).toBe(5);
      // Only the last 5 should remain
      for (let i = 95; i < 100; i++) {
        expect(lru.get(`key-${i}`)).toBe(i);
      }
    });
  });

  // ── Dispose callback ───────────────────────────────────

  describe("dispose callback", () => {
    it("should call dispose on eviction", () => {
      const dispose = vi.fn();
      const lru = new LRUMap<string, number>(2, dispose);
      lru.set("a", 1);
      lru.set("b", 2);

      expect(dispose).not.toHaveBeenCalled();

      lru.set("c", 3); // evicts "a"

      expect(dispose).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledWith(1, "a");
    });

    it("should call dispose on explicit delete", () => {
      const dispose = vi.fn();
      const lru = new LRUMap<string, number>(3, dispose);
      lru.set("a", 1);

      lru.delete("a");

      expect(dispose).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledWith(1, "a");
    });

    it("should not call dispose when deleting non-existent key", () => {
      const dispose = vi.fn();
      const lru = new LRUMap<string, number>(3, dispose);

      const result = lru.delete("nope");

      expect(result).toBe(false);
      expect(dispose).not.toHaveBeenCalled();
    });

    it("should call dispose for every entry on clear", () => {
      const dispose = vi.fn();
      const lru = new LRUMap<string, number>(5, dispose);
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);

      lru.clear();

      expect(dispose).toHaveBeenCalledTimes(3);
      expect(lru.size).toBe(0);
    });

    it("should call dispose in LRU order during clear", () => {
      const calls: string[] = [];
      const lru = new LRUMap<string, number>(3, (_v, k) => calls.push(k));
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);

      lru.clear();

      // Map iterates in insertion order = LRU → MRU
      expect(calls).toEqual(["a", "b", "c"]);
    });
  });

  // ── delete ─────────────────────────────────────────────

  describe("delete", () => {
    it("should remove an existing entry and return true", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("a", 1);
      lru.set("b", 2);

      const result = lru.delete("a");

      expect(result).toBe(true);
      expect(lru.has("a")).toBe(false);
      expect(lru.size).toBe(1);
    });

    it("should return false for non-existent key", () => {
      const lru = new LRUMap<string, number>(3);
      expect(lru.delete("nope")).toBe(false);
    });
  });

  // ── Iterators ──────────────────────────────────────────

  describe("iterators", () => {
    it("should iterate entries in LRU → MRU order", () => {
      const lru = new LRUMap<string, number>(5);
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      lru.get("a"); // promote "a"

      const keys = [...lru.keys()];
      // "b" is LRU, then "c", then "a" (promoted)
      expect(keys).toEqual(["b", "c", "a"]);
    });

    it("should support for..of iteration", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("x", 10);
      lru.set("y", 20);

      const entries: [string, number][] = [];
      for (const entry of lru) {
        entries.push(entry);
      }
      expect(entries).toEqual([
        ["x", 10],
        ["y", 20],
      ]);
    });

    it("should iterate values in LRU → MRU order", () => {
      const lru = new LRUMap<string, number>(3);
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);

      expect([...lru.values()]).toEqual([1, 2, 3]);
    });
  });
});
