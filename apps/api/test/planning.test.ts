// Plan my week, hook variants, carousels: through the real HTTP app with a real session.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { DateTime } from "luxon";
import { createApp } from "../src/app";
import { createSession } from "../src/lib/auth";
import { db } from "../src/db";
import { freeSlots } from "../src/lib/schedule";
import { aiReply, createUser, setup } from "./helpers";

let t: Awaited<ReturnType<typeof setup>>;
let token: string;
const app = createApp();
let aiResponder: (prompt: string) => unknown = () => ({});

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`http://test.local/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

before(async () => {
  t = await setup();
  // The fake AI answers based on the prompt it receives.
  t.route((c) => {
    if (!c.url.endsWith("/chat/completions")) return undefined;
    const prompt = c.body.messages.map((m: any) => m.content).join("\n");
    return aiReply(aiResponder(prompt));
  });
  await createUser("u1", { timezone: "Asia/Kolkata" });
  token = await createSession("u1");
  // Two slots every day, so the next 7 days always have 14 (we cap plans at 10).
  await call("PUT", "/slots", {
    slots: [1, 2, 3, 4, 5, 6, 7].flatMap((d) => [
      { dayOfWeek: d, time: "10:00" },
      { dayOfWeek: d, time: "17:00" },
    ]),
  });
});

test("free slots skip the past and slots that already have a queued post", async () => {
  const all = await freeSlots("u1", 7);
  assert.ok(all.length >= 12 && all.length <= 14, `got ${all.length}`);
  assert.ok(all.every((s) => new Date(s) > new Date()));
  const local = DateTime.fromISO(all[0]).setZone("Asia/Kolkata");
  assert.ok(["10:00", "17:00"].includes(local.toFormat("HH:mm")));

  await db.run("INSERT INTO posts (id, user_id, content, status, scheduled_at) VALUES ('q', 'u1', 'x', 'queued', ?)", all[0]);
  const after = await freeSlots("u1", 7);
  assert.equal(after[0], all[1]);
  assert.ok(!after.includes(all[0]));
  await db.run("DELETE FROM posts WHERE id = 'q'");
});

test("plan my week needs pillars (or topics)", async () => {
  const r = await call("POST", "/plan/week", { days: 7 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /content pillars/);
});

test("plan my week writes one draft per free slot, rotating pillars, then schedules them", async () => {
  const saved = await call("PUT", "/profile", { pillars: ["Hiring", "Shipping fast", "Founder mistakes"] });
  assert.deepEqual(saved.body.pillars, ["Hiring", "Shipping fast", "Founder mistakes"]);

  const prompts: string[] = [];
  aiResponder = (prompt) => {
    prompts.push(prompt);
    const themes = [...prompt.matchAll(/^\d+\. (.+?) \| format:/gm)].map((m) => m[1]);
    return { posts: themes.map((th) => `A post about ${th}.\n\nWith detail.`) };
  };
  const r = await call("POST", "/plan/week", { days: 7 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const items = r.body.items as { post: any; pillar: string; slot: string }[];
  assert.equal(items.length, 10, "capped at 10");
  assert.equal(r.body.missing, 0);
  assert.equal(prompts.length, 5, "10 posts in chunks of 2 -> 5 AI calls");
  assert.equal(new Set(prompts).size, 5, "every chunk asks for something different");
  assert.match(prompts[0], /1\. Hiring \| format: a personal story/);
  assert.deepEqual(
    items.slice(0, 4).map((i) => i.pillar),
    ["Hiring", "Shipping fast", "Founder mistakes", "Hiring"],
  );
  for (const it of items) {
    assert.equal(it.post.content, `A post about ${it.pillar}.\n\nWith detail.`);
    assert.equal(it.post.status, "draft");
  }
  const slots = items.map((i) => i.slot);
  assert.deepEqual(slots, [...slots].sort(), "soonest first");
  assert.equal(new Set(slots).size, slots.length);

  // Schedule the first three; a past time and someone else's post are ignored.
  const other = await createUser("u2");
  await db.run("INSERT INTO posts (id, user_id, content) VALUES ('foreign', ?, 'not yours')", other);
  const s = await call("POST", "/plan/schedule", {
    items: [
      ...items.slice(0, 3).map((i) => ({ postId: i.post.id, scheduledAt: i.slot })),
      { postId: items[3].post.id, scheduledAt: new Date(Date.now() - 60_000).toISOString() },
      { postId: "foreign", scheduledAt: items[4].slot },
    ],
  });
  assert.equal(s.body.posts.length, 3);
  const queued = await db.all<{ id: string; scheduled_at: string; publish_at: string }>(
    "SELECT id, scheduled_at, publish_at FROM posts WHERE status = 'queued' ORDER BY scheduled_at",
  );
  assert.deepEqual(queued.map((q) => q.id), items.slice(0, 3).map((i) => i.post.id));
  assert.equal(queued[0].scheduled_at, new Date(items[0].slot).toISOString());
  const jitterMin = Math.abs(new Date(queued[0].publish_at).getTime() - new Date(queued[0].scheduled_at).getTime()) / 60_000;
  assert.ok(jitterMin <= 7, "random buffer applied within ±7 min");
  assert.equal((await db.get<{ status: string }>("SELECT status FROM posts WHERE id = 'foreign'"))!.status, "draft");

  // Those slots are now taken: the next plan starts after them.
  assert.ok(!(await freeSlots("u1", 7)).includes(items[0].slot));
});

test("plan my week keeps the posts that worked when one AI call fails", async () => {
  await db.run("DELETE FROM posts WHERE status = 'draft'");
  // The 2nd chunk (2 posts) always fails, also on its retry; the 3rd fails once, then works on retry.
  let n = 0;
  let broken = "";
  let flaky = "";
  let flakyFailed = false;
  aiResponder = (prompt) => {
    n++;
    if (n === 2) broken = prompt;
    if (n === 3) flaky = prompt;
    if (prompt === broken) return "not json at all";
    if (prompt === flaky && !flakyFailed) {
      flakyFailed = true;
      return { wrong: "shape" };
    }
    const themes = [...prompt.matchAll(/^\d+\. (.+?) \| format:/gm)].map((m) => m[1]);
    return { posts: themes.map((th) => `Post on ${th}`) };
  };
  const r = await call("POST", "/plan/week", { days: 7 });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length + r.body.missing, 10);
  assert.equal(r.body.missing, 2);
  assert.ok(flakyFailed, "flaky chunk was retried");
});

test("AI JSON with raw line breaks inside strings, or posts as objects, still parses", async () => {
  await db.run("DELETE FROM posts WHERE status = 'draft'");
  aiResponder = (prompt) => {
    const themes = [...prompt.matchAll(/^\d+\. (.+?) \| format:/gm)].map((m) => m[1]);
    // Real line breaks inside the string literals: invalid JSON, common from free models.
    return "```json\n{\"posts\":[" + themes.map((th, i) => (i % 2 ? `{"content":"Line one ${th}\n\nLine two"}` : `"Line one ${th}\n\nLine two"`)).join(",") + "]}\n```";
  };
  const r = await call("POST", "/plan/week", { days: 7 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.missing, 0);
  assert.match(r.body.items[0].post.content, /^Line one .+\n\nLine two$/);
  assert.match(r.body.items[1].post.content, /^Line one .+\n\nLine two$/);
});

test("a second plan run skips slots already covered by drafts on screen", async () => {
  await db.run("DELETE FROM posts WHERE status = 'draft'");
  aiResponder = (prompt) => ({ posts: [...prompt.matchAll(/^\d+\. (.+?) \| format:/gm)].map((m) => `Post ${m[1]}`) });
  const free = await freeSlots("u1", 7, 10);
  const covered = free.slice(0, 7);
  const r = await call("POST", "/plan/week", { days: 7, exclude: covered });
  assert.equal(r.status, 200);
  const got = r.body.items.map((i: any) => i.slot);
  assert.ok(got.every((s: string) => !covered.includes(s)), "no covered slot is rewritten");
  assert.deepEqual(got.slice(0, 3), free.slice(7, 10));
});

test("hook variants", async () => {
  aiResponder = () => ({ hooks: ["**Bold** hook one", "Hook two", "Hook three", "Hook four"] });
  const r = await call("POST", "/ai/hooks", { content: "A long enough post body to get hooks for." });
  assert.deepEqual(r.body.hooks, ["Bold hook one", "Hook two", "Hook three"]);
});

test("carousel outline, and attaching the PDF replaces an image", async () => {
  aiResponder = () => ({
    title: "5 hiring lessons",
    slides: [
      { heading: "Hire slow", body: "" },
      { heading: "Lesson 1", body: "Write the scorecard first." },
      { heading: "Your turn", body: "What's yours?" },
    ],
  });
  const outline = await call("POST", "/ai/carousel", { content: "x".repeat(80) });
  assert.equal(outline.body.title, "5 hiring lessons");
  assert.equal(outline.body.slides.length, 3);

  const { body: post } = await call("POST", "/posts", { content: "Carousel post" });
  await call("PUT", `/posts/${post.id}/image`, { dataUrl: "data:image/png;base64,AAAA", alt: "an image" });
  const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4").toString("base64");
  const r = await call("PUT", `/posts/${post.id}/document`, { dataUrl: pdf, title: outline.body.title, slides: outline.body.slides });
  assert.equal(r.status, 200);
  assert.equal(r.body.hasDocument, true);
  assert.equal(r.body.hasImage, false);
  assert.equal(r.body.imageAlt, null);
  assert.equal(r.body.documentTitle, "5 hiring lessons");
  assert.deepEqual(r.body.carouselSlides, outline.body.slides);
  assert.equal((await db.get<{ data_url: string }>("SELECT data_url FROM post_images WHERE post_id = ?", post.id))!.data_url, pdf);

  const bad = await call("PUT", `/posts/${post.id}/document`, { dataUrl: "data:image/png;base64,AAAA", title: "x", slides: [{ heading: "a", body: "" }] });
  assert.equal(bad.status, 400);

  const removed = await call("DELETE", `/posts/${post.id}/image`);
  assert.equal(removed.body.hasDocument, false);
  assert.equal(removed.body.carouselSlides, null);
});

test("engagement nudge setting round-trips", async () => {
  assert.equal((await call("GET", "/settings")).body.engagementNudge, true);
  const r = await call("PUT", "/settings", { engagementNudge: false });
  assert.equal(r.body.engagementNudge, false);
  assert.equal(r.body.futuristic, false, "futuristic look is off by default");
  assert.equal((await call("PUT", "/settings", { futuristic: true })).body.futuristic, true);
});
