// Runtime-agnostic, async database access. The Node server plugs in better-sqlite3
// (runtime/sqlite.ts); the Cloudflare Worker plugs in D1 (runtime/d1.ts).

export type Param = string | number | null;
export interface Statement {
  sql: string;
  params: Param[];
}

export interface Db {
  get<T = Record<string, any>>(sql: string, ...params: Param[]): Promise<T | undefined>;
  all<T = Record<string, any>>(sql: string, ...params: Param[]): Promise<T[]>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  /** Run several statements atomically. */
  batch(statements: Statement[]): Promise<void>;
}

let current: Db | null = null;

export function setDb(d: Db) {
  current = d;
}

function use(): Db {
  if (!current) throw new Error("Database not initialised");
  return current;
}

export const db: Db = {
  get: (sql, ...p) => use().get(sql, ...p),
  all: (sql, ...p) => use().all(sql, ...p),
  run: (sql, ...p) => use().run(sql, ...p),
  batch: (s) => use().batch(s),
};

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
