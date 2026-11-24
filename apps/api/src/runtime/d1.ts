import type { D1Database } from "@cloudflare/workers-types";
import type { Db } from "../db";

export function d1Db(d1: D1Database): Db {
  return {
    async get(sql, ...params) {
      return ((await d1.prepare(sql).bind(...params).first()) ?? undefined) as any;
    },
    async all(sql, ...params) {
      return (await d1.prepare(sql).bind(...params).all()).results as any[];
    },
    async run(sql, ...params) {
      const r = await d1.prepare(sql).bind(...params).run();
      return { changes: r.meta.changes ?? 0 };
    },
    async batch(statements) {
      if (!statements.length) return;
      await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...s.params)));
    },
  };
}
