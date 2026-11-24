// Row <-> API object mapping and small query helpers.
import type { AppNotification, Idea, Post, Profile, Settings, Slot, User } from "@postdaily/shared";
import { db, newId, nowIso } from "./db";

type Row = Record<string, any>;

export const toUser = (r: Row): User => ({
  id: r.id,
  name: r.name,
  email: r.email,
  picture: r.picture,
  linkedinConnected: Boolean(r.linkedin_token),
  linkedinExpiresAt: r.linkedin_expires_at,
});

export const toPost = (r: Row): Post => ({
  id: r.id,
  content: r.content,
  status: r.status,
  scheduledAt: r.scheduled_at,
  publishedAt: r.published_at,
  linkedinUrn: r.linkedin_urn,
  error: r.error,
  ideaId: r.idea_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toIdea = (r: Row): Idea => ({
  id: r.id,
  text: r.text,
  source: r.source,
  status: r.status,
  forDate: r.for_date,
  createdAt: r.created_at,
});

export const toNotification = (r: Row): AppNotification => ({
  id: r.id,
  title: r.title,
  body: r.body,
  read: Boolean(r.read),
  createdAt: r.created_at,
});

export function getUserRow(userId: string): Row | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Row | undefined;
}

export function ensureUserDefaults(userId: string) {
  db.prepare("INSERT OR IGNORE INTO settings (user_id) VALUES (?)").run(userId);
  db.prepare("INSERT OR IGNORE INTO profiles (user_id) VALUES (?)").run(userId);
  const hasSlots = db.prepare("SELECT 1 FROM slots WHERE user_id = ? LIMIT 1").get(userId);
  if (!hasSlots) {
    // Default: weekdays at 09:00
    const ins = db.prepare("INSERT INTO slots (id, user_id, day_of_week, time) VALUES (?, ?, ?, ?)");
    for (const d of [1, 2, 3, 4, 5]) ins.run(newId(), userId, d, "09:00");
  }
}

export function getSettings(userId: string): Settings {
  const r = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(userId) as Row;
  return {
    aiProvider: r.ai_provider,
    aiModel: r.ai_model,
    defaultLength: r.default_length,
    timezone: r.timezone,
    reminderEnabled: Boolean(r.reminder_enabled),
    reminderTime: r.reminder_time,
    weeklyGoal: r.weekly_goal,
    dailyIdeas: Boolean(r.daily_ideas),
  };
}

export function updateSettings(userId: string, s: Partial<Settings>) {
  const map: Record<keyof Settings, string> = {
    aiProvider: "ai_provider",
    aiModel: "ai_model",
    defaultLength: "default_length",
    timezone: "timezone",
    reminderEnabled: "reminder_enabled",
    reminderTime: "reminder_time",
    weeklyGoal: "weekly_goal",
    dailyIdeas: "daily_ideas",
  };
  for (const [k, v] of Object.entries(s)) {
    const col = map[k as keyof Settings];
    if (!col || v === undefined) continue;
    db.prepare(`UPDATE settings SET ${col} = ? WHERE user_id = ?`).run(typeof v === "boolean" ? Number(v) : v, userId);
  }
  return getSettings(userId);
}

export function getProfile(userId: string): Profile {
  const r = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as Row;
  return {
    niche: r.niche,
    audience: r.audience,
    goals: r.goals,
    topics: JSON.parse(r.topics),
    samplePosts: r.sample_posts,
    styleGuide: r.style_guide,
    bannedPhrases: JSON.parse(r.banned_phrases),
    updatedAt: r.updated_at,
  };
}

export function updateProfile(userId: string, p: Partial<Profile>) {
  const cur = getProfile(userId);
  const next = { ...cur, ...p };
  db.prepare(
    `UPDATE profiles SET niche=?, audience=?, goals=?, topics=?, sample_posts=?, style_guide=?, banned_phrases=?, updated_at=? WHERE user_id=?`,
  ).run(
    next.niche,
    next.audience,
    next.goals,
    JSON.stringify(next.topics ?? []),
    next.samplePosts,
    next.styleGuide,
    JSON.stringify(next.bannedPhrases ?? []),
    nowIso(),
    userId,
  );
  return getProfile(userId);
}

export function getSlots(userId: string): Slot[] {
  return (db.prepare("SELECT * FROM slots WHERE user_id = ? ORDER BY day_of_week, time").all(userId) as Row[]).map(
    (r) => ({ id: r.id, dayOfWeek: r.day_of_week, time: r.time }),
  );
}

export function getPost(userId: string, id: string): Post | null {
  const r = db.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  return r ? toPost(r) : null;
}

export function addNotification(userId: string, title: string, body: string) {
  db.prepare("INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)").run(newId(), userId, title, body);
}
