import BetterSqlite3 from "better-sqlite3";
import { MigrationRunner } from "../migrations/migration-runner";

/**
 * Thin connection owner for the application's SQLite database.
 *
 * Responsibilities:
 * - Opens and configures the better-sqlite3 connection (WAL mode, foreign keys, pragmas)
 * - Integrates with {@link MigrationRunner} to apply pending schema migrations
 * - Provides a typed `transaction()` wrapper matching better-sqlite3's transaction API
 * - Manages connection lifecycle (open / close)
 *
 * All query logic lives in domain-specific repository classes that receive the
 * raw `better-sqlite3` `Database` instance via {@link getConnection}.
 */
export class Database {
  private readonly db: BetterSqlite3.Database;

  constructor(dbPath: string, migrationsDir: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    const runner = new MigrationRunner(this.db, migrationsDir);
    runner.run();
  }

  /**
   * Return the underlying better-sqlite3 connection.
   *
   * Repository classes use this to prepare and execute statements.
   * The connection remains owned by this Database instance — callers
   * must not close it directly.
   */
  getConnection(): BetterSqlite3.Database {
    return this.db;
  }

  /**
   * Execute a callback inside a SQLite transaction.
   *
   * Wraps better-sqlite3's `transaction()` API: the callback receives the raw
   * connection, runs inside an implicit BEGIN / COMMIT, and rolls back
   * automatically if the callback throws.
   *
   * @returns The value returned by `fn`.
   */
  transaction<T>(fn: (conn: BetterSqlite3.Database) => T): T {
    const wrapped = this.db.transaction(() => fn(this.db));
    return wrapped();
  }

  /** Close the underlying SQLite connection. */
  close(): void {
    this.db.close();
  }
}
