import { Hono } from "hono";
import { z } from "zod";
import { AI_PROVIDERS, POST_LENGTHS, REWRITE_ACTIONS } from "@postdaily/shared";
import { db, newId, type Statement } from "../db";
import { getProfile, getSettings, getSlots, getVoiceProfile, toNotification, updateProfile, updateSettings } from "../repo";
import { listOpenRouterModels, providerStatuses } from "../ai/providers";
import { analyzeStyle, generateDrafts, rewritePost } from "../ai/writer";
import { computeStats } from "../lib/schedule";
import { pushEnabled, saveSubscription, sendPush } from "../lib/push";
import { env } from "../runtime/env";
import type { AppEnv } from "../lib/auth";

export const main = new Hono<AppEnv>();

// --- Settings & AI providers ---
main.get("/settings", async (c) => c.json(await getSettings(c.get("userId"))));
main.put("/settings", async (c) => {
  const body = z
    .object({
      aiProvider: z.enum(AI_PROVIDERS),
      aiModel: z.string().min(1),
      defaultLength: z.enum(POST_LENGTHS),
      timezone: z.string().refine((tz) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "Unknown timezone"),
      reminderEnabled: z.boolean(),
      reminderTime: z.string().regex(/^\d{2}:\d{2}$/),
      weeklyGoal: z.number().int().min(1).max(21),
      dailyIdeas: z.boolean(),
      jitterEnabled: z.boolean(),
      jitterMinutes: z.number().int().min(1).max(30),
    })
    .partial()
    .parse(await c.req.json());
  return c.json(await updateSettings(c.get("userId"), body));
});
main.get("/ai/providers", async (c) => c.json(await providerStatuses()));
main.get("/ai/models", async (c) =>
  c.json(c.req.query("provider") === "openrouter" ? await listOpenRouterModels() : []),
);

// --- Writing-style profile ---
main.get("/profile", async (c) => c.json(await getProfile(c.get("userId"))));
main.put("/profile", async (c) => {
  const body = z
    .object({
      niche: z.string(),
      audience: z.string(),
      goals: z.string(),
      topics: z.array(z.string()),
      samplePosts: z.string(),
      styleGuide: z.string(),
      bannedPhrases: z.array(z.string()),
    })
    .partial()
    .parse(await c.req.json());
  return c.json(await updateProfile(c.get("userId"), body));
});
main.post("/profile/analyze", async (c) => {
  const uid = c.get("userId");
  const profile = await getVoiceProfile(uid);
  const { styleGuide, topics } = await analyzeStyle(await getSettings(uid), profile);
  await db.run("UPDATE profiles SET style_refresh_due = 0 WHERE user_id = ?", uid);
  return c.json(await updateProfile(uid, { styleGuide, topics: profile.topics.length ? profile.topics : topics }));
});
main.delete("/profile/learned", async (c) => {
  await db.run("UPDATE profiles SET learned_posts = '[]' WHERE user_id = ?", c.get("userId"));
  return c.json(await getProfile(c.get("userId")));
});

// --- AI writing ---
main.post("/ai/drafts", async (c) => {
  const uid = c.get("userId");
  const { input, length } = z
    .object({ input: z.string().min(3, "Give me at least a few words"), length: z.enum(POST_LENGTHS) })
    .parse(await c.req.json());
  const drafts = await generateDrafts(await getSettings(uid), await getVoiceProfile(uid), input, length);
  return c.json({ drafts });
});
main.post("/ai/rewrite", async (c) => {
  const uid = c.get("userId");
  const { content, action, instruction } = z
    .object({
      content: z.string().min(1),
      action: z.enum(Object.keys(REWRITE_ACTIONS) as [keyof typeof REWRITE_ACTIONS]),
      instruction: z.string().optional(),
    })
    .parse(await c.req.json());
  return c.json({
    content: await rewritePost(await getSettings(uid), await getVoiceProfile(uid), content, action, instruction),
  });
});

// --- Weekly posting slots ---
main.get("/slots", async (c) => c.json(await getSlots(c.get("userId"))));
main.put("/slots", async (c) => {
  const uid = c.get("userId");
  const { slots } = z
    .object({
      slots: z.array(z.object({ dayOfWeek: z.number().int().min(1).max(7), time: z.string().regex(/^\d{2}:\d{2}$/) })),
    })
    .parse(await c.req.json());
  const stmts: Statement[] = [{ sql: "DELETE FROM slots WHERE user_id = ?", params: [uid] }];
  const seen = new Set<string>();
  for (const s of slots) {
    const key = `${s.dayOfWeek}-${s.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stmts.push({
      sql: "INSERT INTO slots (id, user_id, day_of_week, time) VALUES (?, ?, ?, ?)",
      params: [newId(), uid, s.dayOfWeek, s.time],
    });
  }
  await db.batch(stmts);
  return c.json(await getSlots(uid));
});

// --- Streaks / stats ---
main.get("/stats", async (c) => c.json(await computeStats(c.get("userId"))));

// --- Push notifications (installable app) ---
main.get("/push/config", (c) => c.json({ enabled: pushEnabled(), publicKey: env("VAPID_PUBLIC_KEY") ?? null }));
main.post("/push/subscribe", async (c) => {
  const { endpoint } = z.object({ endpoint: z.string().url().startsWith("https://") }).parse(await c.req.json());
  await saveSubscription(c.get("userId"), endpoint);
  return c.json({ ok: true });
});
main.post("/push/unsubscribe", async (c) => {
  const { endpoint } = z.object({ endpoint: z.string() }).parse(await c.req.json());
  await db.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", endpoint, c.get("userId"));
  return c.json({ ok: true });
});
main.post("/push/test", async (c) => {
  await db.run(
    "INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)",
    newId(),
    c.get("userId"),
    "PostDaily test",
    "Push notifications are working.",
  );
  return c.json({ sent: await sendPush(c.get("userId")) });
});

// --- In-app notifications (reminders, publish results) ---
main.get("/notifications", async (c) =>
  c.json(
    (await db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", c.get("userId"))).map(
      toNotification,
    ),
  ),
);
main.post("/notifications/read", async (c) => {
  await db.run("UPDATE notifications SET read = 1 WHERE user_id = ?", c.get("userId"));
  return c.json({ ok: true });
});
