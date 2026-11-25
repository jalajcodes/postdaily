import { Hono } from "hono";
import { z } from "zod";
import { AI_PROVIDERS, POST_LENGTHS, REWRITE_ACTIONS } from "@postdaily/shared";
import type { PlannedPost } from "@postdaily/shared";
import { db, newId, type Statement } from "../db";
import {
  getLearnedPosts,
  getPost,
  getProfile,
  getSettings,
  getSlots,
  getVoiceProfile,
  toNotification,
  updateProfile,
  updateSettings,
} from "../repo";
import { listOpenRouterModels, providerStatuses } from "../ai/providers";
import {
  analyzeStyle,
  generateCarousel,
  generateCoverHeadlines,
  generateDrafts,
  generateHooks,
  generatePlannedPosts,
  PLAN_FORMATS,
  rewritePost,
  rewriteSlide,
} from "../ai/writer";
import { brandSchema, slideSchema } from "../lib/carousel";
import { MAX_AUDIO_BYTES, transcribe, transcriptionAvailable } from "../ai/transcribe";
import { computeStats, freeSlots, schedulePost } from "../lib/schedule";
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
      engagementNudge: z.boolean(),
      carouselBrand: brandSchema,
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
      pillars: z.array(z.string().trim().min(1).max(120)).max(8),
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

main.post("/ai/hooks", async (c) => {
  const uid = c.get("userId");
  const { content } = z.object({ content: z.string().min(20, "Write a bit more first") }).parse(await c.req.json());
  return c.json({ hooks: await generateHooks(await getSettings(uid), await getVoiceProfile(uid), content) });
});
main.post("/ai/carousel", async (c) => {
  const uid = c.get("userId");
  const { content } = z.object({ content: z.string().min(50, "Write the post first") }).parse(await c.req.json());
  return c.json(await generateCarousel(await getSettings(uid), await getVoiceProfile(uid), content));
});
main.post("/ai/carousel/covers", async (c) => {
  const uid = c.get("userId");
  const { content, current } = z.object({ content: z.string().min(1), current: z.string().max(200) }).parse(await c.req.json());
  return c.json({ headlines: await generateCoverHeadlines(await getSettings(uid), await getVoiceProfile(uid), content, current) });
});
main.post("/ai/carousel/slide", async (c) => {
  const uid = c.get("userId");
  const { content, slide, instruction } = z
    .object({ content: z.string().min(1), slide: slideSchema, instruction: z.string().max(300).optional() })
    .parse(await c.req.json());
  return c.json({ slide: await rewriteSlide(await getSettings(uid), await getVoiceProfile(uid), content, slide, instruction) });
});

// --- Voice notes: recorded audio in, text out (for browsers without live dictation) ---
main.get("/ai/transcribe", (c) => c.json({ available: transcriptionAvailable() }));
main.post("/ai/transcribe", async (c) => {
  const type = c.req.header("Content-Type") ?? "";
  if (!type.startsWith("audio/")) return c.json({ error: "Send the recording as audio" }, 415);
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) return c.json({ error: "That recording is too long. Keep voice notes under 5 minutes." }, 413);
  const audio = new Uint8Array(await c.req.arrayBuffer());
  if (audio.length > MAX_AUDIO_BYTES) return c.json({ error: "That recording is too long. Keep voice notes under 5 minutes." }, 413);
  if (audio.length < 1000) return c.json({ error: "The recording was empty. Try again." }, 400);
  const text = await transcribe(audio, type);
  if (!text) return c.json({ error: "Didn't catch any words. Try again a little closer to the mic." }, 422);
  return c.json({ text });
});

// Your LinkedIn photo, proxied so the browser can draw it on carousel slides (a cross-origin
// image would block exporting the slides). Only LinkedIn's media hosts are fetched.
main.get("/me/avatar", async (c) => {
  const row = await db.get<{ picture: string | null }>("SELECT picture FROM users WHERE id = ?", c.get("userId"));
  let url: URL;
  try {
    url = new URL(row?.picture ?? "");
  } catch {
    return c.json({ error: "No profile photo" }, 404);
  }
  if (url.protocol !== "https:" || !(url.hostname === "licdn.com" || url.hostname.endsWith(".licdn.com")))
    return c.json({ error: "No profile photo" }, 404);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return c.json({ error: "Couldn't load your profile photo" }, 502);
  return new Response(await res.arrayBuffer(), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
});

// --- Plan my week: one draft per free slot, rotating through your content pillars ---
const PLAN_MAX = 10;
const PLAN_CHUNK = 2; // posts per AI call (calls run in parallel; small chunks finish faster on free models)

main.get("/plan/slots", async (c) => {
  const days = Math.min(14, Math.max(1, Number(c.req.query("days")) || 7));
  return c.json({ slots: await freeSlots(c.get("userId"), days, PLAN_MAX) });
});
main.post("/plan/week", async (c) => {
  const uid = c.get("userId");
  const { days, exclude } = z
    .object({ days: z.number().int().min(1).max(14).default(7), exclude: z.array(z.string()).max(50).default([]) })
    .parse(await c.req.json().catch(() => ({})));
  // `exclude`: slots that already have a fresh draft on screen (from an earlier, partial plan).
  const skip = new Set(exclude.map((s) => new Date(s).toISOString()));
  const slots = (await freeSlots(uid, days, PLAN_MAX + skip.size)).filter((s) => !skip.has(s)).slice(0, PLAN_MAX);
  if (!slots.length) return c.json({ error: `No free posting slots in the next ${days} days. Add posting times in Queue.` }, 400);
  const profile = await getVoiceProfile(uid);
  const pillars = profile.pillars.length ? profile.pillars : profile.topics;
  if (!pillars.length) return c.json({ error: "Add a few content pillars first." }, 400);

  // Rotate formats on a different cycle than pillars, so theme+format pairs vary across the week.
  const plan = slots.map((slot, i) => ({ slot, pillar: pillars[i % pillars.length], format: PLAN_FORMATS[i % PLAN_FORMATS.length] }));
  const recent = [
    ...(await getLearnedPosts(uid)),
    ...(await db.all<{ content: string }>("SELECT content FROM posts WHERE user_id = ? AND status IN ('queued','draft') ORDER BY updated_at DESC LIMIT 6", uid)).map((r) => r.content),
  ].slice(0, 10);
  const settings = await getSettings(uid);
  const chunks = Array.from({ length: Math.ceil(plan.length / PLAN_CHUNK) }, (_, i) => plan.slice(i * PLAN_CHUNK, (i + 1) * PLAN_CHUNK));
  // Free models fail now and then (busy, malformed JSON): retry a failed chunk once.
  const write = (chunk: typeof plan) => generatePlannedPosts(settings, profile, chunk, recent);
  const results = await Promise.allSettled(chunks.map((chunk) => write(chunk).catch(() => write(chunk))));
  for (const r of results) if (r.status === "rejected") console.warn("[plan] chunk failed:", (r.reason as Error)?.message);
  if (results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;

  const items: PlannedPost[] = [];
  for (const [ci, r] of results.entries()) {
    if (r.status !== "fulfilled") continue;
    for (const [i, content] of r.value.entries()) {
      const { slot, pillar } = chunks[ci][i];
      const id = newId();
      await db.run("INSERT INTO posts (id, user_id, content) VALUES (?, ?, ?)", id, uid, content);
      items.push({ post: (await getPost(uid, id))!, pillar, slot });
    }
  }
  return c.json({ items, missing: plan.length - items.length });
});
main.post("/plan/schedule", async (c) => {
  const uid = c.get("userId");
  const { items } = z
    .object({ items: z.array(z.object({ postId: z.string(), scheduledAt: z.string().datetime({ offset: true }) })).min(1).max(20) })
    .parse(await c.req.json());
  const scheduled = [];
  for (const it of items) {
    const p = await getPost(uid, it.postId);
    if (!p || p.status !== "draft" || !p.content.trim() || new Date(it.scheduledAt) <= new Date()) continue;
    await schedulePost(uid, p.id, it.scheduledAt);
    scheduled.push((await getPost(uid, p.id))!);
  }
  return c.json({ posts: scheduled });
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
