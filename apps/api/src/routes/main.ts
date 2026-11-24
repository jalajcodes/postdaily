import { Hono } from "hono";
import { z } from "zod";
import { AI_PROVIDERS, POST_LENGTHS, REWRITE_ACTIONS } from "@postdaily/shared";
import { db, newId } from "../db";
import { getProfile, getSettings, getSlots, toNotification, updateProfile, updateSettings } from "../repo";
import { providerStatuses } from "../ai/providers";
import { analyzeStyle, generateDrafts, rewritePost } from "../ai/writer";
import { computeStats } from "../lib/schedule";
import type { AppEnv } from "../lib/auth";

export const main = new Hono<AppEnv>();

// --- Settings & AI providers ---
main.get("/settings", (c) => c.json(getSettings(c.get("userId"))));
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
    })
    .partial()
    .parse(await c.req.json());
  return c.json(updateSettings(c.get("userId"), body));
});
main.get("/ai/providers", async (c) => c.json(await providerStatuses()));

// --- Writing-style profile ---
main.get("/profile", (c) => c.json(getProfile(c.get("userId"))));
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
  return c.json(updateProfile(c.get("userId"), body));
});
main.post("/profile/analyze", async (c) => {
  const uid = c.get("userId");
  const profile = getProfile(uid);
  const { styleGuide, topics } = await analyzeStyle(getSettings(uid), profile);
  return c.json(
    updateProfile(uid, { styleGuide, topics: profile.topics.length ? profile.topics : topics }),
  );
});

// --- AI writing ---
main.post("/ai/drafts", async (c) => {
  const uid = c.get("userId");
  const { input, length } = z
    .object({ input: z.string().min(3, "Give me at least a few words"), length: z.enum(POST_LENGTHS) })
    .parse(await c.req.json());
  const drafts = await generateDrafts(getSettings(uid), getProfile(uid), input, length);
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
  return c.json({ content: await rewritePost(getSettings(uid), getProfile(uid), content, action, instruction) });
});

// --- Weekly posting slots ---
main.get("/slots", (c) => c.json(getSlots(c.get("userId"))));
main.put("/slots", async (c) => {
  const uid = c.get("userId");
  const { slots } = z
    .object({
      slots: z.array(z.object({ dayOfWeek: z.number().int().min(1).max(7), time: z.string().regex(/^\d{2}:\d{2}$/) })),
    })
    .parse(await c.req.json());
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM slots WHERE user_id = ?").run(uid);
    const ins = db.prepare("INSERT INTO slots (id, user_id, day_of_week, time) VALUES (?, ?, ?, ?)");
    const seen = new Set<string>();
    for (const s of slots) {
      const key = `${s.dayOfWeek}-${s.time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ins.run(newId(), uid, s.dayOfWeek, s.time);
    }
  });
  tx();
  return c.json(getSlots(uid));
});

// --- Streaks / stats ---
main.get("/stats", (c) => c.json(computeStats(c.get("userId"))));

// --- In-app notifications (reminders, publish results) ---
main.get("/notifications", (c) =>
  c.json(
    (
      db
        .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30")
        .all(c.get("userId")) as any[]
    ).map(toNotification),
  ),
);
main.post("/notifications/read", (c) => {
  db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(c.get("userId"));
  return c.json({ ok: true });
});
