// Node-only: better-sqlite3 behind the async Db interface, plus migrations.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db";

export function sqliteDb(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Apply every migration file (they're idempotent), then add columns that older local DBs lack.
  const dir = path.resolve(import.meta.dirname, "../../migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  addColumn("settings", "jitter_enabled", "INTEGER NOT NULL DEFAULT 1");
  addColumn("settings", "jitter_minutes", "INTEGER NOT NULL DEFAULT 7");
  addColumn("posts", "jitter_minutes", "INTEGER NOT NULL DEFAULT 0");
  addColumn("posts", "publish_at", "TEXT");

  return {
    async get(sql, ...params) {
      return sqlite.prepare(sql).get(...params) as any;
    },
    async all(sql, ...params) {
      return sqlite.prepare(sql).all(...params) as any[];
    },
    async run(sql, ...params) {
      return { changes: sqlite.prepare(sql).run(...params).changes };
    },
    async batch(statements) {
      sqlite.transaction(() => {
        for (const s of statements) sqlite.prepare(s.sql).run(...s.params);
      })();
    },
  };
}
