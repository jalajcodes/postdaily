// Background jobs. `runScheduledTick` runs once a minute: from a timer on the Node server,
// or from a Cron Trigger on Cloudflare. Each run:
//  - publishes queued posts that are due
//  - generates the day's ideas each morning
//  - reminds you if you haven't posted (or queued) anything by your reminder time
import { DateTime } from "luxon";
import { db, nowIso } from "./db";
import { addNotification, getProfile, getSettings, getVoiceProfile, updateProfile } from "./repo";
import { analyzeStyle } from "./ai/writer";
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
    const row = (await db.get("SELECT last_reminder_date, last_ideas_date, linkedin_warning FROM settings WHERE user_id = ?", id))!;
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

    await linkedinExpiryWarning(id, row.linkedin_warning);
    await refreshStyleIfDue(id);

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

const WARNING_LEVEL = { "7d": 1, "1d": 2, expired: 3 } as const;
type Warning = keyof typeof WARNING_LEVEL;

/** Warn 7 days and 1 day before the LinkedIn connection expires, and once when it has expired. */
async function linkedinExpiryWarning(userId: string, sent: Warning | null) {
  const user = await db.get<{ linkedin_token: string | null; linkedin_expires_at: string | null }>(
    "SELECT linkedin_token, linkedin_expires_at FROM users WHERE id = ?",
    userId,
  );
  if (!user?.linkedin_token || !user.linkedin_expires_at) return;
  const daysLeft = (new Date(user.linkedin_expires_at).getTime() - Date.now()) / 86_400_000;
  const due: Warning | null = daysLeft <= 0 ? "expired" : daysLeft <= 1 ? "1d" : daysLeft <= 7 ? "7d" : null;
  if (!due) {
    // Reconnected since the last warning: start over.
    if (sent) await db.run("UPDATE settings SET linkedin_warning = NULL WHERE user_id = ?", userId);
    return;
  }
  if (sent && WARNING_LEVEL[sent] >= WARNING_LEVEL[due]) return;
  await db.run("UPDATE settings SET linkedin_warning = ? WHERE user_id = ?", due, userId);
  const body =
    due === "expired"
      ? "Your LinkedIn connection has expired, so scheduled posts can't go out. Reconnect it in Settings."
      : `Your LinkedIn connection expires in ${due === "1d" ? "less than a day" : `${Math.ceil(daysLeft)} days`}. Reconnect it in Settings so scheduled posts keep going out.`;
  await addNotification(userId, due === "expired" ? "LinkedIn disconnected" : "Reconnect LinkedIn soon", body);
  desktopNotify?.("PostDaily", body);
}

/** Every 5 published posts, re-learn the style guide from your samples plus what you've published. */
async function refreshStyleIfDue(userId: string) {
  const due = await db.get("SELECT 1 FROM profiles WHERE user_id = ? AND style_refresh_due = 1", userId);
  if (!due) return;
  await db.run("UPDATE profiles SET style_refresh_due = 0 WHERE user_id = ?", userId);
  try {
    const profile = await getVoiceProfile(userId);
    const { styleGuide } = await analyzeStyle(await getSettings(userId), profile);
    await updateProfile(userId, { styleGuide });
    await addNotification(userId, "Style guide updated", "PostDaily re-learned your style from your latest published posts.");
  } catch (e) {
    console.warn(`[style] ${userId}: ${(e as Error).message}`);
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
