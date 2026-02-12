/**
 * Mock database factory for unit tests.
 *
 * Creates an in-memory SQLite database via better-sqlite3 with all migrations
 * applied, then wraps it in an AppDatabase instance. Each call produces a fresh,
 * isolated database so tests never leak state.
 *
 * Usage:
 *   import { createMockDatabase } from "../test-utils/mock-database";
 *
 *   let db: ReturnType<typeof createMockDatabase>["db"];
 *   let cleanup: () => void;
 *
 *   beforeEach(() => {
 *     const mock = createMockDatabase();
 *     db = mock.db;
 *     cleanup = mock.cleanup;
 *   });
 *
 *   afterEach(() => cleanup());
 */

import { resolve } from "node:path";
import { AppDatabase } from "../main/runtime/app-database";

/** Absolute path to the SQL migration files shipped with the project. */
const MIGRATIONS_DIR = resolve(__dirname, "../../resources/migrations");

export interface MockDatabase {
  /** Fully initialised AppDatabase backed by an in-memory SQLite instance. */
  db: AppDatabase;
  /** Close the underlying database connection. Call this in afterEach. */
  cleanup: () => void;
}

/**
 * Create a fresh in-memory AppDatabase with all migrations applied.
 *
 * The underlying `better-sqlite3` Database uses `:memory:` so no file I/O
 * occurs and each instance is completely independent.
 */
export function createMockDatabase(): MockDatabase {
  const db = new AppDatabase(":memory:", MIGRATIONS_DIR);

  return {
    db,
    cleanup: () => db.close()
  };
}
