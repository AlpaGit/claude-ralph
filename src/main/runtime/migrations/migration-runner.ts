import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

interface MigrationFile {
  name: string;
  number: number;
  path: string;
}

export class MigrationRunner {
  private readonly db: Database.Database;
  private readonly migrationsDir: string;

  constructor(db: Database.Database, migrationsDir: string) {
    this.db = db;
    this.migrationsDir = migrationsDir;
  }

  run(): void {
    this.ensureSchemaMigrationsTable();

    const applied = this.getAppliedMigrations();
    const available = this.scanMigrationFiles();
    const pending = available.filter((m) => !applied.has(m.name));

    for (const migration of pending) {
      this.applyMigration(migration);
    }
  }

  private ensureSchemaMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
  }

  private getAppliedMigrations(): Set<string> {
    const rows = this.db.prepare("SELECT name FROM schema_migrations ORDER BY name ASC;").all() as {
      name: string;
    }[];

    return new Set(rows.map((row) => row.name));
  }

  private scanMigrationFiles(): MigrationFile[] {
    let entries: string[];
    try {
      entries = readdirSync(this.migrationsDir);
    } catch {
      return [];
    }

    const sqlFiles = entries.filter((entry) => entry.endsWith(".sql"));
    const migrations: MigrationFile[] = [];

    for (const file of sqlFiles) {
      const match = file.match(/^(\d+)/);
      if (!match) {
        continue;
      }

      migrations.push({
        name: file,
        number: parseInt(match[1], 10),
        path: join(this.migrationsDir, file),
      });
    }

    migrations.sort((a, b) => a.number - b.number);
    return migrations;
  }

  private applyMigration(migration: MigrationFile): void {
    const sql = readFileSync(migration.path, "utf-8");

    const transaction = this.db.transaction(() => {
      this.db.exec(sql);
      this.db
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?);")
        .run(migration.name, new Date().toISOString());
    });

    transaction();
  }
}
