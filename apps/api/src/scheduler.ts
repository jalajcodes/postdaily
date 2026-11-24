// Background jobs, checked every minute:
//  - publish queued posts that are due
//  - generate the day's ideas each morning
//  - remind you if you haven't posted (or queued) anything by your reminder time
import { DateTime } from "luxon";
import { execFile } from "node:child_process";
import { db } from "./db";
import { addNotification, getProfile, getSettings } from "./repo";
import { computeStats, publishNow } from "./lib/schedule";
import { createIdeasForToday } from "./routes/ideas";

const running = new Set<string>();

async function publishDue() {
  const due = db
    .prepare("SELECT id, user_id FROM posts WHERE status = 'queued' AND scheduled_at <= ? ORDER BY scheduled_at")
    .all(new Date().toISOString()) as { id: string; user_id: string }[];
  for (const p of due) {
    if (running.has(p.id)) continue;
    running.add(p.id);
    try {
      const result = await publishNow(p.user_id, p.id);
      if (result.status === "published") addNotification(p.user_id, "Posted to LinkedIn", result.content.slice(0, 80));
      else addNotification(p.user_id, "Scheduled post failed", result.error ?? "Unknown error");
    } finally {
      running.delete(p.id);
    }
  }
}

function macNotify(title: string, body: string) {
  if (process.platform !== "darwin" || process.env.MAC_NOTIFICATIONS === "false") return;
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => {});
}

async function dailyJobs() {
  const users = db.prepare("SELECT id FROM users").all() as { id: string }[];
  for (const { id } of users) {
    const s = getSettings(id);
    const row = db.prepare("SELECT last_reminder_date, last_ideas_date FROM settings WHERE user_id = ?").get(id) as any;
    const now = DateTime.now().setZone(s.timezone);
    const today = now.toISODate()!;

    // Morning ideas (from 07:00, once a day, only if a profile exists)
    if (s.dailyIdeas && row.last_ideas_date !== today && now.hour >= 7) {
      db.prepare("UPDATE settings SET last_ideas_date = ? WHERE user_id = ?").run(today, id);
      const profile = getProfile(id);
      if (profile.niche || profile.samplePosts || profile.topics.length) {
        createIdeasForToday(id).catch((e) => console.warn(`[ideas] ${id}: ${(e as Error).message}`));
      }
    }

    // Reminder
    if (s.reminderEnabled && row.last_reminder_date !== today && now.toFormat("HH:mm") >= s.reminderTime) {
      db.prepare("UPDATE settings SET last_reminder_date = ? WHERE user_id = ?").run(today, id);
      const stats = computeStats(id);
      if (!stats.postedToday && !stats.queuedToday) {
        const body =
          stats.dailyStreak > 0
            ? `You're on a ${stats.dailyStreak}-day streak. Write today's post to keep it going.`
            : "You haven't posted today. Got 10 minutes for one idea?";
        addNotification(id, "Time to post on LinkedIn", body);
        macNotify("PostDaily", body);
      }
    }
  }
}

export function startScheduler() {
  const tick = async () => {
    try {
      await publishDue();
      await dailyJobs();
    } catch (e) {
      console.error("[scheduler]", e);
    }
  };
  tick();
  setInterval(tick, 60_000);
}
