// Background jobs. `runScheduledTick` runs once a minute: from a timer on the Node server,
// or from a Cron Trigger on Cloudflare. Each run:
//  - publishes queued posts that are due
//  - generates the day's ideas each morning
//  - reminds you if you haven't posted (or queued) anything by your reminder time
import { DateTime } from "luxon";
import { db, nowIso } from "./db";
import { addNotification, getProfile, getSettings } from "./repo";
import { computeStats, publishNow } from "./lib/schedule";
import { createIdeasForToday } from "./routes/ideas";

/** Optional OS-level notification (the Mac server plugs in macOS notifications). */
let desktopNotify: ((title: string, body: string) => void) | null = null;
export function setDesktopNotifier(fn: (title: string, body: string) => void) {
  desktopNotify = fn;
}

async function publishDue() {
  // A post stuck in 'publishing' for 10+ minutes means a run died mid-publish.
  await db.run(
    "UPDATE posts SET status='failed', error='Publishing was interrupted. Check LinkedIn before retrying.', updated_at=? WHERE status='publishing' AND updated_at < ?",
    nowIso(),
    new Date(Date.now() - 10 * 60_000).toISOString(),
  );

  const due = await db.all<{ id: string; user_id: string }>(
    "SELECT id, user_id FROM posts WHERE status = 'queued' AND COALESCE(publish_at, scheduled_at) <= ? ORDER BY COALESCE(publish_at, scheduled_at)",
    nowIso(),
  );
  for (const p of due) {
    const result = await publishNow(p.user_id, p.id);
    if (result.status === "published") await addNotification(p.user_id, "Posted to LinkedIn", result.content.slice(0, 80));
    else if (result.status === "failed") await addNotification(p.user_id, "Scheduled post failed", result.error ?? "Unknown error");
  }
}

async function dailyJobs() {
  const users = await db.all<{ id: string }>("SELECT id FROM users");
  for (const { id } of users) {
    const s = await getSettings(id);
    const row = (await db.get("SELECT last_reminder_date, last_ideas_date FROM settings WHERE user_id = ?", id))!;
    const now = DateTime.now().setZone(s.timezone);
    const today = now.toISODate()!;

    // Morning ideas (from 07:00, once a day, only if a profile exists)
    if (s.dailyIdeas && row.last_ideas_date !== today && now.hour >= 7) {
      await db.run("UPDATE settings SET last_ideas_date = ? WHERE user_id = ?", today, id);
      const profile = await getProfile(id);
      if (profile.niche || profile.samplePosts || profile.topics.length) {
        await createIdeasForToday(id).catch((e) => console.warn(`[ideas] ${id}: ${(e as Error).message}`));
      }
    }

    // Reminder
    if (s.reminderEnabled && row.last_reminder_date !== today && now.toFormat("HH:mm") >= s.reminderTime) {
      await db.run("UPDATE settings SET last_reminder_date = ? WHERE user_id = ?", today, id);
      const stats = await computeStats(id);
      if (!stats.postedToday && !stats.queuedToday) {
        const body =
          stats.dailyStreak > 0
            ? `You're on a ${stats.dailyStreak}-day streak. Write today's post to keep it going.`
            : "You haven't posted today. Got 10 minutes for one idea?";
        await addNotification(id, "Time to post on LinkedIn", body);
        desktopNotify?.("PostDaily", body);
      }
    }
  }
}

export async function runScheduledTick() {
  try {
    await publishDue();
  } catch (e) {
    console.error("[scheduler] publish", e);
  }
  try {
    await dailyJobs();
  } catch (e) {
    console.error("[scheduler] daily", e);
  }
}
