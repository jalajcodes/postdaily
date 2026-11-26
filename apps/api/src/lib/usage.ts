// Daily AI allowance for accounts using the server's shared keys. The owner (the first account
// created) is never limited, and neither is anyone using their own API key.
import type { AiAllowance } from "@postdaily/shared";
import { db } from "../db";
import { env } from "../runtime/env";

export type UsageKind = "text" | "image";

const DEFAULTS: Record<UsageKind, [string, number]> = {
  text: ["AI_DAILY_LIMIT", 40],
  image: ["AI_IMAGE_DAILY_LIMIT", 5],
};

export function dailyLimit(kind: UsageKind) {
  const [name, fallback] = DEFAULTS[kind];
  const n = Number(env(name));
  return Number.isFinite(n) && n >= 0 && env(name) !== undefined ? Math.floor(n) : fallback;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function isOwner(userId: string) {
  const first = await db.get<{ id: string }>("SELECT id FROM users ORDER BY created_at, rowid LIMIT 1");
  return first?.id === userId;
}

/** Uses one request from today's allowance. False if it's used up. */
export async function takeAllowance(userId: string, kind: UsageKind): Promise<boolean> {
  if (await isOwner(userId)) return true;
  const limit = dailyLimit(kind);
  if (limit === 0) return false;
  // One atomic statement: the row is only bumped while it's under the limit.
  const r = await db.run(
    `INSERT INTO ai_usage (user_id, day, kind, count) VALUES (?, ?, ?, 1)
     ON CONFLICT (user_id, day, kind) DO UPDATE SET count = count + 1 WHERE count < ?`,
    userId,
    today(),
    kind,
    limit,
  );
  return r.changes > 0;
}

/** Today's usage, or null for the owner (no limits). */
export async function allowance(userId: string): Promise<AiAllowance | null> {
  if (await isOwner(userId)) return null;
  const rows = await db.all<{ kind: UsageKind; count: number }>(
    "SELECT kind, count FROM ai_usage WHERE user_id = ? AND day = ?",
    userId,
    today(),
  );
  const used = (k: UsageKind) => rows.find((r) => r.kind === k)?.count ?? 0;
  return {
    text: { used: used("text"), limit: dailyLimit("text") },
    image: { used: used("image"), limit: dailyLimit("image") },
  };
}
