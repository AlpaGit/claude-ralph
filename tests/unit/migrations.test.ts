/**
 * Unit tests for MigrationRunner.
 *
 * Covers:
 *   - Apply all migrations to an empty database
 *   - Skip already-applied migrations
 *   - Detect and handle corrupt migration state
 *   - Migration ordering (numeric sort)
 *   - Transaction rollback on SQL error
 *   - schema_migrations table tracking
 *
 * Uses in-memory SQLite and temporary migration file directories.
 *
 * NOTE: better-sqlite3 is a native module. When compiled for Electron
 * (via electron-rebuild in postinstall), it may not load under system Node.
 * Run `npm rebuild better-sqlite3` (with Electron stopped) to rebuild
 * for system Node before running these tests.
 */

import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Probe whether native better-sqlite3 can create a database instance.
// ---------------------------------------------------------------------------
let sqliteAvailable = false;
let DatabaseCtor: typeof import("better-sqlite3").default;
try {
  const require = createRequire(import.meta.url);
  DatabaseCtor = require("better-sqlite3");
  const probe = new DatabaseCtor(":memory:");
  probe.close();
  sqliteAvailable = true;
} catch {
  // Native module ABI mismatch or other load failure -- skip suite
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory for migration files and return its path. */
function createTempMigrationsDir(): string {
  return mkdtempSync(join(tmpdir(), "ralph-migrations-test-"));
}

/** Write a migration SQL file into the given directory. */
function writeMigration(dir: string, filename: string, sql: string): void {
  writeFileSync(join(dir, filename), sql, "utf-8");
}

/** Query all rows from schema_migrations, ordered by name ASC. */
function getAppliedMigrations(
  db: import("better-sqlite3").Database
): Array<{ name: string; applied_at: string }> {
  return db
    .prepare("SELECT name, applied_at FROM schema_migrations ORDER BY name ASC")
    .all() as Array<{ name: string; applied_at: string }>;
}

/** Check if a table exists in the database. */
function tableExists(db: import("better-sqlite3").Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName) as { cnt: number };
  return row.cnt > 0;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!sqliteAvailable)("MigrationRunner", () => {
  let MigrationRunner: typeof import("../../src/main/runtime/migrations/migration-runner").MigrationRunner;
  let db: import("better-sqlite3").Database;
  let migrationsDir: string;

  beforeEach(async () => {
    const mod = await import("../../src/main/runtime/migrations/migration-runner");
    MigrationRunner = mod.MigrationRunner;
    db = new DatabaseCtor(":memory:");
    migrationsDir = createTempMigrationsDir();
  });

  afterEach(() => {
    db?.close();
    try {
      rmSync(migrationsDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  // =========================================================================
  // schema_migrations table creation
  // =========================================================================

  describe("schema_migrations table", () => {
    it("should create schema_migrations table on first run", () => {
      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      expect(tableExists(db, "schema_migrations")).toBe(true);
    });

    it("should not fail if schema_migrations table already exists", () => {
      // Manually create the table first
      db.exec(`
        CREATE TABLE schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      expect(() => runner.run()).not.toThrow();
      expect(tableExists(db, "schema_migrations")).toBe(true);
    });
  });

  // =========================================================================
  // Apply all migrations to empty DB
  // =========================================================================

  describe("apply all migrations to empty DB", () => {
    it("should apply a single migration file", () => {
      writeMigration(migrationsDir, "001_create_users.sql", `
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      // Table should exist
      expect(tableExists(db, "users")).toBe(true);

      // schema_migrations should track it
      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(1);
      expect(applied[0].name).toBe("001_create_users.sql");
      expect(applied[0].applied_at).toBeTruthy();
    });

    it("should apply multiple migration files in order", () => {
      writeMigration(migrationsDir, "001_create_users.sql", `
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      `);
      writeMigration(migrationsDir, "002_create_posts.sql", `
        CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT NOT NULL);
      `);
      writeMigration(migrationsDir, "003_create_comments.sql", `
        CREATE TABLE comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, text TEXT NOT NULL);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      expect(tableExists(db, "users")).toBe(true);
      expect(tableExists(db, "posts")).toBe(true);
      expect(tableExists(db, "comments")).toBe(true);

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(3);
      expect(applied.map((m) => m.name)).toEqual([
        "001_create_users.sql",
        "002_create_posts.sql",
        "003_create_comments.sql"
      ]);
    });

    it("should handle empty migrations directory", () => {
      const runner = new MigrationRunner(db, migrationsDir);

      expect(() => runner.run()).not.toThrow();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(0);
    });

    it("should handle non-existent migrations directory gracefully", () => {
      const nonExistentDir = join(migrationsDir, "does-not-exist");
      const runner = new MigrationRunner(db, nonExistentDir);

      expect(() => runner.run()).not.toThrow();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(0);
    });

    it("should record applied_at as a valid ISO timestamp", () => {
      writeMigration(migrationsDir, "001_test.sql", `
        CREATE TABLE test_table (id TEXT PRIMARY KEY);
      `);

      const before = new Date();
      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();
      const after = new Date();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(1);

      const appliedAt = new Date(applied[0].applied_at);
      expect(appliedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(appliedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });
  });

  // =========================================================================
  // Skip already-applied migrations
  // =========================================================================

  describe("skip already-applied migrations", () => {
    it("should not re-apply migrations that are already in schema_migrations", () => {
      writeMigration(migrationsDir, "001_create_users.sql", `
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      `);

      // Run once
      const runner1 = new MigrationRunner(db, migrationsDir);
      runner1.run();

      expect(getAppliedMigrations(db)).toHaveLength(1);

      // Run again -- should not fail or re-apply
      const runner2 = new MigrationRunner(db, migrationsDir);
      expect(() => runner2.run()).not.toThrow();

      // Still exactly one entry
      expect(getAppliedMigrations(db)).toHaveLength(1);
    });

    it("should only apply new migrations added after first run", () => {
      writeMigration(migrationsDir, "001_create_users.sql", `
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      `);

      // First run
      const runner1 = new MigrationRunner(db, migrationsDir);
      runner1.run();
      expect(getAppliedMigrations(db)).toHaveLength(1);

      // Add a new migration
      writeMigration(migrationsDir, "002_create_posts.sql", `
        CREATE TABLE posts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      `);

      // Second run -- should only apply 002
      const runner2 = new MigrationRunner(db, migrationsDir);
      runner2.run();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(2);
      expect(applied.map((m) => m.name)).toEqual([
        "001_create_users.sql",
        "002_create_posts.sql"
      ]);

      expect(tableExists(db, "users")).toBe(true);
      expect(tableExists(db, "posts")).toBe(true);
    });

    it("should skip already-applied even if migration file content changed", () => {
      writeMigration(migrationsDir, "001_create_users.sql", `
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      `);

      // Apply migration
      const runner1 = new MigrationRunner(db, migrationsDir);
      runner1.run();

      // Overwrite migration file with different SQL (simulate editing after apply)
      writeMigration(migrationsDir, "001_create_users.sql", `
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT);
      `);

      // Run again -- should skip (name matches, not content)
      const runner2 = new MigrationRunner(db, migrationsDir);
      expect(() => runner2.run()).not.toThrow();

      // Still only one migration applied
      expect(getAppliedMigrations(db)).toHaveLength(1);

      // The table should NOT have the email column (original migration ran, not the updated one)
      const columns = db
        .prepare("PRAGMA table_info(users)")
        .all() as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).not.toContain("email");
    });
  });

  // =========================================================================
  // Migration ordering (numeric sort)
  // =========================================================================

  describe("migration ordering", () => {
    it("should apply migrations in numeric order regardless of filesystem order", () => {
      // Write files in reverse order to ensure sorting is tested
      writeMigration(migrationsDir, "003_third.sql", `
        CREATE TABLE third (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "001_first.sql", `
        CREATE TABLE first (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "002_second.sql", `
        CREATE TABLE second (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      const applied = getAppliedMigrations(db);
      expect(applied.map((m) => m.name)).toEqual([
        "001_first.sql",
        "002_second.sql",
        "003_third.sql"
      ]);
    });

    it("should handle non-contiguous migration numbers", () => {
      writeMigration(migrationsDir, "001_first.sql", `
        CREATE TABLE first (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "005_fifth.sql", `
        CREATE TABLE fifth (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "010_tenth.sql", `
        CREATE TABLE tenth (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(3);
      expect(applied.map((m) => m.name)).toEqual([
        "001_first.sql",
        "005_fifth.sql",
        "010_tenth.sql"
      ]);
    });

    it("should sort by numeric prefix, not lexicographic order", () => {
      // Lexicographic: "10" < "2" but numeric: 2 < 10
      writeMigration(migrationsDir, "2_second.sql", `
        CREATE TABLE second_table (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "10_tenth.sql", `
        CREATE TABLE tenth_table (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "1_first.sql", `
        CREATE TABLE first_table (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      const applied = getAppliedMigrations(db);
      expect(applied.map((m) => m.name)).toEqual([
        "1_first.sql",
        "2_second.sql",
        "10_tenth.sql"
      ]);
    });

    it("should ignore non-SQL files in the migrations directory", () => {
      writeMigration(migrationsDir, "001_create_users.sql", `
        CREATE TABLE users (id TEXT PRIMARY KEY);
      `);
      // Write non-SQL files
      writeFileSync(join(migrationsDir, "README.md"), "# Migrations");
      writeFileSync(join(migrationsDir, "notes.txt"), "Some notes");
      writeFileSync(join(migrationsDir, "backup.sql.bak"), "Backup");

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(1);
      expect(applied[0].name).toBe("001_create_users.sql");
    });

    it("should ignore SQL files without a numeric prefix", () => {
      writeMigration(migrationsDir, "001_valid.sql", `
        CREATE TABLE valid_table (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "create_legacy.sql", `
        CREATE TABLE legacy_table (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "no_number.sql", `
        CREATE TABLE no_number_table (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(1);
      expect(applied[0].name).toBe("001_valid.sql");

      // Non-numeric-prefix files should not create tables
      expect(tableExists(db, "valid_table")).toBe(true);
      expect(tableExists(db, "legacy_table")).toBe(false);
      expect(tableExists(db, "no_number_table")).toBe(false);
    });
  });

  // =========================================================================
  // Transaction rollback on SQL error
  // =========================================================================

  describe("transaction rollback on SQL error", () => {
    it("should roll back a migration with invalid SQL", () => {
      writeMigration(migrationsDir, "001_valid.sql", `
        CREATE TABLE valid_table (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "002_broken.sql", `
        THIS IS NOT VALID SQL AT ALL;
      `);

      const runner = new MigrationRunner(db, migrationsDir);

      // The runner should throw when attempting the broken migration
      expect(() => runner.run()).toThrow();

      // Migration 001 should have been applied successfully
      expect(tableExists(db, "valid_table")).toBe(true);

      // Migration 002 should NOT be recorded in schema_migrations (rolled back)
      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(1);
      expect(applied[0].name).toBe("001_valid.sql");
    });

    it("should roll back partially-applied migration with multiple statements", () => {
      writeMigration(migrationsDir, "001_multi_statement.sql", `
        CREATE TABLE alpha (id TEXT PRIMARY KEY);
        CREATE TABLE beta (id TEXT PRIMARY KEY);
        THIS WILL FAIL;
      `);

      const runner = new MigrationRunner(db, migrationsDir);

      expect(() => runner.run()).toThrow();

      // Both tables should be rolled back since the entire migration is in a transaction
      expect(tableExists(db, "alpha")).toBe(false);
      expect(tableExists(db, "beta")).toBe(false);

      // No migration should be recorded
      // schema_migrations table may or may not exist depending on implementation
      // but if it does, it should be empty
      if (tableExists(db, "schema_migrations")) {
        const applied = getAppliedMigrations(db);
        expect(applied).toHaveLength(0);
      }
    });

    it("should allow retrying after a failed migration is fixed", () => {
      writeMigration(migrationsDir, "001_valid.sql", `
        CREATE TABLE valid_table (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "002_broken.sql", `
        INVALID SQL HERE;
      `);

      const runner1 = new MigrationRunner(db, migrationsDir);
      expect(() => runner1.run()).toThrow();

      // Fix the broken migration
      writeMigration(migrationsDir, "002_broken.sql", `
        CREATE TABLE fixed_table (id TEXT PRIMARY KEY);
      `);

      // Retry should succeed
      const runner2 = new MigrationRunner(db, migrationsDir);
      expect(() => runner2.run()).not.toThrow();

      expect(tableExists(db, "valid_table")).toBe(true);
      expect(tableExists(db, "fixed_table")).toBe(true);

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(2);
      expect(applied.map((m) => m.name)).toEqual([
        "001_valid.sql",
        "002_broken.sql"
      ]);
    });

    it("should not record the migration name if SQL execution fails", () => {
      writeMigration(migrationsDir, "001_bad.sql", `
        CREATE TABLE good_part (id TEXT PRIMARY KEY);
        INSERT INTO nonexistent_table VALUES ('fail');
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      expect(() => runner.run()).toThrow();

      // The migration name should NOT appear in schema_migrations
      if (tableExists(db, "schema_migrations")) {
        const applied = getAppliedMigrations(db);
        expect(applied).toHaveLength(0);
      }
    });
  });

  // =========================================================================
  // Corrupt migration state
  // =========================================================================

  describe("corrupt migration state", () => {
    it("should handle stale entries in schema_migrations for missing files", () => {
      // Pre-populate schema_migrations with a migration that no longer exists on disk
      db.exec(`
        CREATE TABLE schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations (name, applied_at)
          VALUES ('001_deleted.sql', '2025-01-01T00:00:00.000Z');
      `);

      // Only add migration 002 on disk
      writeMigration(migrationsDir, "002_new.sql", `
        CREATE TABLE new_table (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);

      // Should not throw -- 001_deleted.sql is in schema_migrations but not on disk,
      // and 002_new.sql is on disk but not in schema_migrations -> apply it
      expect(() => runner.run()).not.toThrow();

      expect(tableExists(db, "new_table")).toBe(true);

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(2);
      expect(applied.map((m) => m.name)).toContain("001_deleted.sql");
      expect(applied.map((m) => m.name)).toContain("002_new.sql");
    });

    it("should handle schema_migrations with extra columns gracefully", () => {
      // Create schema_migrations with additional columns (forward-compatible)
      db.exec(`
        CREATE TABLE schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL,
          checksum TEXT
        );
      `);

      writeMigration(migrationsDir, "001_test.sql", `
        CREATE TABLE test_table (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);

      // Should still work because it only reads/writes name and applied_at
      expect(() => runner.run()).not.toThrow();

      expect(tableExists(db, "test_table")).toBe(true);

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(1);
    });

    it("should not duplicate entries when run is called multiple times", () => {
      writeMigration(migrationsDir, "001_test.sql", `
        CREATE TABLE test_table (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);

      // Run three times
      runner.run();
      runner.run();
      runner.run();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(1);
      expect(applied[0].name).toBe("001_test.sql");
    });
  });

  // =========================================================================
  // schema_migrations tracking
  // =========================================================================

  describe("schema_migrations tracking", () => {
    it("should track each migration with its filename", () => {
      writeMigration(migrationsDir, "001_users.sql", `
        CREATE TABLE users (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "002_posts.sql", `
        CREATE TABLE posts (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      const applied = getAppliedMigrations(db);
      expect(applied).toHaveLength(2);
      expect(applied[0].name).toBe("001_users.sql");
      expect(applied[1].name).toBe("002_posts.sql");
    });

    it("should store applied_at timestamps in chronological order", () => {
      writeMigration(migrationsDir, "001_first.sql", `
        CREATE TABLE first (id TEXT PRIMARY KEY);
      `);
      writeMigration(migrationsDir, "002_second.sql", `
        CREATE TABLE second (id TEXT PRIMARY KEY);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      const applied = getAppliedMigrations(db);
      const ts1 = new Date(applied[0].applied_at).getTime();
      const ts2 = new Date(applied[1].applied_at).getTime();

      // Second migration should be applied at or after the first
      expect(ts2).toBeGreaterThanOrEqual(ts1);
    });

    it("should use the full filename including .sql extension as the migration name", () => {
      writeMigration(migrationsDir, "042_feature_flags.sql", `
        CREATE TABLE feature_flags (id TEXT PRIMARY KEY, enabled INTEGER);
      `);

      const runner = new MigrationRunner(db, migrationsDir);
      runner.run();

      const applied = getAppliedMigrations(db);
      expect(applied[0].name).toBe("042_feature_flags.sql");
    });
  });

  // =========================================================================
  // Integration: real project migrations
  // =========================================================================

  describe("real project migrations", () => {
    it("should apply all project migration files from resources/migrations", async () => {
      const { resolve } = await import("node:path");
      const projectMigrationsDir = resolve(__dirname, "../../resources/migrations");

      const runner = new MigrationRunner(db, projectMigrationsDir);
      runner.run();

      // Verify core tables from 001_initial.sql exist
      expect(tableExists(db, "plans")).toBe(true);
      expect(tableExists(db, "tasks")).toBe(true);
      expect(tableExists(db, "runs")).toBe(true);
      expect(tableExists(db, "run_events")).toBe(true);
      expect(tableExists(db, "todo_snapshots")).toBe(true);

      // Verify schema_migrations has entries for all migration files
      const applied = getAppliedMigrations(db);
      expect(applied.length).toBeGreaterThanOrEqual(5);

      // Check that migration names are sorted
      const names = applied.map((m) => m.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it("should be idempotent when applied twice with real migrations", async () => {
      const { resolve } = await import("node:path");
      const projectMigrationsDir = resolve(__dirname, "../../resources/migrations");

      const runner = new MigrationRunner(db, projectMigrationsDir);
      runner.run();

      const appliedFirst = getAppliedMigrations(db);

      // Run again
      runner.run();

      const appliedSecond = getAppliedMigrations(db);
      expect(appliedSecond).toEqual(appliedFirst);
    });
  });
});
