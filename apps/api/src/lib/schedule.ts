// Slot math, publishing and streak stats.
import { DateTime } from "luxon";
import type { Post, Stats } from "@postdaily/shared";
import { db, nowIso } from "../db";
import { getSettings, getSlots, getUserRow, toPost } from "../repo";
import { publishPost } from "./linkedin";

/** Next weekly slot (in the user's timezone) that has no post queued yet. */
export async function nextFreeSlot(userId: string): Promise<string | null> {
  const { timezone } = await getSettings(userId);
  const slots = await getSlots(userId);
  if (!slots.length) return null;
  const taken = new Set(
    (await db.all("SELECT scheduled_at FROM posts WHERE user_id = ? AND status = 'queued'", userId)).map((r) =>
      DateTime.fromISO(r.scheduled_at).toUTC().toISO(),
    ),
  );
  const now = DateTime.now().setZone(timezone);
  for (let d = 0; d < 7 * 26; d++) {
    const day = now.startOf("day").plus({ days: d });
    const candidates = slots
      .filter((s) => s.dayOfWeek === day.weekday)
      .map((s) => {
        const [h, m] = s.time.split(":").map(Number);
        return day.set({ hour: h, minute: m });
      })
      .sort((a, b) => a.toMillis() - b.toMillis());
    for (const c of candidates) {
      if (c <= now) continue;
      const iso = c.toUTC().toISO()!;
      if (!taken.has(iso)) return iso;
    }
  }
  return null;
}

/** A random time within ±minutes of `iso`, never sooner than a minute from now. */
export function jitteredTime(iso: string, minutes: number): string {
  const base = new Date(iso).getTime();
  if (!minutes) return new Date(base).toISOString();
  const offsetMs = Math.round((Math.random() * 2 - 1) * minutes * 60) * 1000;
  return new Date(Math.max(base + offsetMs, Date.now() + 60_000)).toISOString();
}

/**
 * Queue a post for `scheduledAt`. With jitter on (default: the user's setting), the real
 * publish time is shifted randomly by up to ±jitterMinutes so posts don't go out on the dot.
 */
export async function schedulePost(userId: string, postId: string, scheduledAt: string, jitter?: boolean) {
  const s = await getSettings(userId);
  const minutes = (jitter ?? s.jitterEnabled) ? s.jitterMinutes : 0;
  const at = new Date(scheduledAt).toISOString();
  await db.run(
    "UPDATE posts SET status='queued', scheduled_at=?, publish_at=?, jitter_minutes=?, error=NULL, updated_at=? WHERE id=? AND user_id=?",
    at,
    jitteredTime(at, minutes),
    minutes,
    nowIso(),
    postId,
    userId,
  );
}

/**
 * Publish one post to LinkedIn now. Claims the post first (status -> 'publishing') so two
 * scheduler runs can never publish the same post twice. Marks it published or failed.
 */
export async function publishNow(userId: string, postId: string): Promise<Post> {
  const row = await db.get("SELECT * FROM posts WHERE id = ? AND user_id = ?", postId, userId);
  if (!row) throw new Error("Post not found");
  if (row.status === "published" || row.status === "publishing") return toPost(row);

  const claimed = await db.run(
    "UPDATE posts SET status='publishing', updated_at=? WHERE id=? AND status IN ('draft','queued','failed')",
    nowIso(),
    postId,
  );
  if (!claimed.changes) return toPost((await db.get("SELECT * FROM posts WHERE id = ?", postId))!);

  try {
    const user = await getUserRow(userId);
    if (!user?.linkedin_token || !user.linkedin_sub) throw new Error("Connect your LinkedIn account in Settings first.");
    if (user.linkedin_expires_at && new Date(user.linkedin_expires_at) < new Date())
      throw new Error("Your LinkedIn connection expired. Reconnect it in Settings.");
    const urn = await publishPost(user.linkedin_token, user.linkedin_sub, row.content);
    const stmts = [
      {
        sql: "UPDATE posts SET status='published', published_at=?, linkedin_urn=?, error=NULL, updated_at=? WHERE id=?",
        params: [nowIso(), urn, nowIso(), postId],
      },
    ];
    if (row.idea_id) stmts.push({ sql: "UPDATE ideas SET status='used' WHERE id=?", params: [row.idea_id] });
    await db.batch(stmts);
  } catch (e) {
    await db.run("UPDATE posts SET status='failed', error=?, updated_at=? WHERE id=?", (e as Error).message, nowIso(), postId);
  }
  return toPost((await db.get("SELECT * FROM posts WHERE id = ?", postId))!);
}

export async function computeStats(userId: string): Promise<Stats> {
  const { timezone, weeklyGoal } = await getSettings(userId);
  const now = DateTime.now().setZone(timezone);
  const published = (
    await db.all("SELECT published_at FROM posts WHERE user_id = ? AND status = 'published'", userId)
  ).map((r) => DateTime.fromISO(r.published_at).setZone(timezone));

  const perDay = new Map<string, number>();
  for (const p of published) perDay.set(p.toISODate()!, (perDay.get(p.toISODate()!) ?? 0) + 1);

  const today = now.toISODate()!;
  const postedToday = perDay.has(today);

  // Daily streak: consecutive days with a post, ending today (or yesterday if not posted yet today).
  let dailyStreak = 0;
  let cursor = postedToday ? now : now.minus({ days: 1 });
  while (perDay.has(cursor.toISODate()!)) {
    dailyStreak++;
    cursor = cursor.minus({ days: 1 });
  }

  const weekCount = (start: DateTime) => published.filter((p) => p >= start && p < start.plus({ weeks: 1 })).length;
  const thisWeekStart = now.startOf("week");
  const thisWeek = weekCount(thisWeekStart);

  // Weekly streak: consecutive weeks meeting the goal (this week counts once it's met).
  let weeklyStreak = thisWeek >= weeklyGoal ? 1 : 0;
  let w = thisWeekStart.minus({ weeks: 1 });
  while (weekCount(w) >= weeklyGoal) {
    weeklyStreak++;
    w = w.minus({ weeks: 1 });
  }

  const heatmap = Array.from({ length: 84 }, (_, i) => {
    const d = now.minus({ days: 83 - i }).toISODate()!;
    return { date: d, count: perDay.get(d) ?? 0 };
  });

  const queued = (
    await db.all("SELECT * FROM posts WHERE user_id = ? AND status = 'queued' ORDER BY scheduled_at LIMIT 50", userId)
  ).map(toPost);
  const queuedToday = queued.some((p) => DateTime.fromISO(p.scheduledAt!).setZone(timezone).toISODate() === today);

  return {
    dailyStreak,
    weeklyStreak,
    thisWeek,
    weeklyGoal,
    totalPublished: published.length,
    postedToday,
    queuedToday,
    nextScheduled: queued[0] ?? null,
    heatmap,
  };
}
