// Row <-> API object mapping and small query helpers.
import { DEFAULT_MODELS, type AIProviderId, type AppNotification, type Idea, type Post, type Profile, type Settings, type Slot, type User } from "@postdaily/shared";
import { db, newId, nowIso, type Statement } from "./db";
import { env } from "./runtime/env";
import { sendPush } from "./lib/push";

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
  publishAt: r.publish_at ?? r.scheduled_at,
  jitterMinutes: r.jitter_minutes ?? 0,
  publishedAt: r.published_at,
  linkedinUrn: r.linkedin_urn,
  error: r.error,
  ideaId: r.idea_id,
  retryCount: r.retry_count ?? 0,
  firstComment: r.first_comment ?? null,
  commentError: r.comment_error ?? null,
  hasImage: Boolean(r.has_image),
  imageAlt: r.image_alt ?? null,
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

export function getUserRow(userId: string) {
  return db.get("SELECT * FROM users WHERE id = ?", userId);
}

export async function ensureUserDefaults(userId: string) {
  // The Cloudflare deployment can't use the local Claude login, so it defaults to another provider.
  const provider = (env("DEFAULT_AI_PROVIDER") ?? "claude-code") as AIProviderId;
  const stmts: Statement[] = [
    {
      sql: "INSERT OR IGNORE INTO settings (user_id, ai_provider, ai_model) VALUES (?, ?, ?)",
      params: [userId, provider, DEFAULT_MODELS[provider] ?? DEFAULT_MODELS["claude-code"]],
    },
    { sql: "INSERT OR IGNORE INTO profiles (user_id) VALUES (?)", params: [userId] },
  ];
  const hasSlots = await db.get("SELECT 1 FROM slots WHERE user_id = ? LIMIT 1", userId);
  if (!hasSlots) {
    // Default: weekdays at 09:00
    for (const d of [1, 2, 3, 4, 5])
      stmts.push({ sql: "INSERT INTO slots (id, user_id, day_of_week, time) VALUES (?, ?, ?, ?)", params: [newId(), userId, d, "09:00"] });
  }
  await db.batch(stmts);
}

export async function getSettings(userId: string): Promise<Settings> {
  const r = (await db.get("SELECT * FROM settings WHERE user_id = ?", userId))!;
  return {
    aiProvider: r.ai_provider,
    aiModel: r.ai_model,
    defaultLength: r.default_length,
    timezone: r.timezone,
    reminderEnabled: Boolean(r.reminder_enabled),
    reminderTime: r.reminder_time,
    weeklyGoal: r.weekly_goal,
    dailyIdeas: Boolean(r.daily_ideas),
    jitterEnabled: Boolean(r.jitter_enabled),
    jitterMinutes: r.jitter_minutes,
  };
}

const SETTINGS_COLUMNS: Record<keyof Settings, string> = {
  aiProvider: "ai_provider",
  aiModel: "ai_model",
  defaultLength: "default_length",
  timezone: "timezone",
  reminderEnabled: "reminder_enabled",
  reminderTime: "reminder_time",
  weeklyGoal: "weekly_goal",
  dailyIdeas: "daily_ideas",
  jitterEnabled: "jitter_enabled",
  jitterMinutes: "jitter_minutes",
};

export async function updateSettings(userId: string, s: Partial<Settings>) {
  const stmts: Statement[] = [];
  for (const [k, v] of Object.entries(s)) {
    const col = SETTINGS_COLUMNS[k as keyof Settings];
    if (!col || v === undefined) continue;
    stmts.push({
      sql: `UPDATE settings SET ${col} = ? WHERE user_id = ?`,
      params: [typeof v === "boolean" ? Number(v) : (v as string | number), userId],
    });
  }
  await db.batch(stmts);
  return getSettings(userId);
}

export async function getProfile(userId: string): Promise<Profile> {
  const r = (await db.get("SELECT * FROM profiles WHERE user_id = ?", userId))!;
  return {
    niche: r.niche,
    audience: r.audience,
    goals: r.goals,
    topics: JSON.parse(r.topics),
    samplePosts: r.sample_posts,
    styleGuide: r.style_guide,
    bannedPhrases: JSON.parse(r.banned_phrases),
    learnedCount: JSON.parse(r.learned_posts ?? "[]").length,
    updatedAt: r.updated_at,
  };
}

export async function updateProfile(userId: string, p: Partial<Profile>) {
  const next = { ...(await getProfile(userId)), ...p };
  await db.run(
    `UPDATE profiles SET niche=?, audience=?, goals=?, topics=?, sample_posts=?, style_guide=?, banned_phrases=?, updated_at=? WHERE user_id=?`,
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

export async function getSlots(userId: string): Promise<Slot[]> {
  const rows = await db.all("SELECT * FROM slots WHERE user_id = ? ORDER BY day_of_week, time", userId);
  return rows.map((r) => ({ id: r.id, dayOfWeek: r.day_of_week, time: r.time }));
}

export async function getPost(userId: string, id: string): Promise<Post | null> {
  const r = await db.get("SELECT * FROM posts WHERE id = ? AND user_id = ?", id, userId);
  return r ? toPost(r) : null;
}

/** Recently published posts kept as extra voice examples (newest first). */
export async function getLearnedPosts(userId: string): Promise<string[]> {
  const r = await db.get("SELECT learned_posts FROM profiles WHERE user_id = ?", userId);
  return JSON.parse(r?.learned_posts ?? "[]");
}

/** Profile with recently published posts attached, for the AI writer. */
export async function getVoiceProfile(userId: string) {
  return { ...(await getProfile(userId)), learnedPosts: await getLearnedPosts(userId) };
}

/** In-app notification, plus a push to the user's phone/desktop if they enabled it. */
export async function addNotification(userId: string, title: string, body: string) {
  await db.run("INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)", newId(), userId, title, body);
  await sendPush(userId).catch((e) => console.warn("[push]", e));
}
