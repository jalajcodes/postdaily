// Slot math, publishing and streak stats.
import { DateTime } from "luxon";
import type { Post, Stats } from "@postdaily/shared";
import { db, nowIso } from "../db";
import { getSettings, getSlots, getUserRow, toPost } from "../repo";
import { publishPost } from "./linkedin";

/** Next weekly slot (in the user's timezone) that has no post queued yet. */
export function nextFreeSlot(userId: string): string | null {
  const { timezone } = getSettings(userId);
  const slots = getSlots(userId);
  if (!slots.length) return null;
  const taken = new Set(
    (db.prepare("SELECT scheduled_at FROM posts WHERE user_id = ? AND status = 'queued'").all(userId) as any[]).map(
      (r) => DateTime.fromISO(r.scheduled_at).toUTC().toISO(),
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

/** Publish one post to LinkedIn now. Marks it published or failed. */
export async function publishNow(userId: string, postId: string): Promise<Post> {
  const user = getUserRow(userId);
  const row = db.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?").get(postId, userId) as any;
  if (!row) throw new Error("Post not found");
  if (row.status === "published") return toPost(row);
  try {
    if (!user?.linkedin_token || !user.linkedin_sub) throw new Error("Connect your LinkedIn account in Settings first.");
    if (user.linkedin_expires_at && new Date(user.linkedin_expires_at) < new Date())
      throw new Error("Your LinkedIn connection expired. Reconnect it in Settings.");
    db.prepare("UPDATE posts SET status='publishing', updated_at=? WHERE id=?").run(nowIso(), postId);
    const urn = await publishPost(user.linkedin_token, user.linkedin_sub, row.content);
    db.prepare(
      "UPDATE posts SET status='published', published_at=?, linkedin_urn=?, error=NULL, updated_at=? WHERE id=?",
    ).run(nowIso(), urn, nowIso(), postId);
    if (row.idea_id) db.prepare("UPDATE ideas SET status='used' WHERE id=?").run(row.idea_id);
  } catch (e) {
    db.prepare("UPDATE posts SET status='failed', error=?, updated_at=? WHERE id=?").run(
      (e as Error).message,
      nowIso(),
      postId,
    );
  }
  return toPost(db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) as any);
}

export function computeStats(userId: string): Stats {
  const { timezone, weeklyGoal } = getSettings(userId);
  const now = DateTime.now().setZone(timezone);
  const published = (
    db.prepare("SELECT published_at FROM posts WHERE user_id = ? AND status = 'published'").all(userId) as any[]
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

  const weekCount = (start: DateTime) =>
    published.filter((p) => p >= start && p < start.plus({ weeks: 1 })).length;
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
    db
      .prepare("SELECT * FROM posts WHERE user_id = ? AND status = 'queued' ORDER BY scheduled_at LIMIT 50")
      .all(userId) as any[]
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
