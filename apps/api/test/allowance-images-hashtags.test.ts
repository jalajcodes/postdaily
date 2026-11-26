// Daily AI allowance on the shared key, AI images (Workers AI faked at the binding), and your
// hashtags/sets. Real HTTP app + real DB; only external HTTP and the AI binding are faked.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createApp } from "../src/app";
import { createSession } from "../src/lib/auth";
import { db } from "../src/db";
import { setAiBinding } from "../src/ai/transcribe";
import { IMAGE_MODEL_IDS } from "../src/ai/image";
import { aiReply, createUser, json, setup } from "./helpers";

let t: Awaited<ReturnType<typeof setup>>;
const app = createApp();
const tokens: Record<string, string> = {};
let aiText: unknown = "Shorter post";
const imageRuns: { model: string; input: any }[] = [];
const okImage = async () => ({ image: "/9j/" + "A".repeat(400) });
let imageResult: () => Promise<unknown> = okImage;

/** The prompt (and other fields) sent to the image model, for either input format. */
async function sent(run: { model: string; input: any }) {
  if (!run.input.multipart) return run.input;
  const { body, contentType } = run.input.multipart;
  const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  return Object.fromEntries(form);
}

async function call(user: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`http://test.local/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokens[user]}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}
const rewrite = (user: string) => call(user, "POST", "/ai/rewrite", { content: "Some post", action: "shorter" });
const chatCalls = () => t.calls.filter((c) => c.url.endsWith("/chat/completions"));

before(async () => {
  t = await setup({ AI_DAILY_LIMIT: "2", AI_IMAGE_DAILY_LIMIT: "1", KEYS_SECRET: "test-keys-secret-0123456789abcdef" });
  t.route((c) => {
    if (c.url.endsWith("/chat/completions")) return aiReply(aiText);
    if (c.url === "https://openrouter.ai/api/v1/key") return json({ data: {} });
    return undefined;
  });
  // "owner" is created first, so it's the owner.
  for (const u of ["owner", "friend", "other"]) {
    await createUser(u);
    tokens[u] = await createSession(u);
  }
});

test("the owner has no limit; other accounts get a daily allowance on the shared key", async () => {
  for (let i = 0; i < 4; i++) assert.equal((await rewrite("owner")).status, 200);
  assert.equal((await call("owner", "GET", "/settings/keys")).body.allowance, null);

  assert.equal((await rewrite("friend")).status, 200);
  assert.equal((await rewrite("friend")).status, 200);
  const before = chatCalls().length;
  const third = await rewrite("friend");
  assert.equal(third.status, 429);
  assert.match(third.body.error, /today's 2 AI requests on the shared key.*Add your own key/);
  assert.equal(chatCalls().length, before, "no AI call once the allowance is used up");
  assert.deepEqual((await call("friend", "GET", "/settings/keys")).body.allowance, {
    text: { used: 2, limit: 2 },
    image: { used: 0, limit: 1 },
  });

  // With their own key there's no limit, and it isn't counted.
  const saved = await call("friend", "PUT", "/settings/keys/openrouter", { key: "sk-or-v1-friendfriendfriendfriendfriend" });
  assert.equal(saved.status, 200);
  assert.equal((await rewrite("friend")).status, 200);
  assert.equal(chatCalls().at(-1)!.headers.authorization, "Bearer sk-or-v1-friendfriendfriendfriendfriend");
  assert.equal((await call("friend", "GET", "/settings/keys")).body.allowance.text.used, 2);

  // Yesterday's usage doesn't count today.
  await db.run("UPDATE ai_usage SET day = '2000-01-01' WHERE user_id = 'friend'");
  await call("friend", "DELETE", "/settings/keys/openrouter");
  assert.equal((await rewrite("friend")).status, 200);
});

test("parallel requests can't go over the allowance", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => rewrite("other")));
  assert.equal(results.filter((r) => r.status === 200).length, 2);
  assert.equal(results.filter((r) => r.status === 429).length, 4);
});

test("AI image: the AI describes one from the post, FLUX.2 draws it by default; your own description skips that step", async () => {
  assert.equal((await call("owner", "GET", "/ai/image")).body.available, false);
  assert.equal((await call("owner", "POST", "/ai/image", { content: "A long enough post about lighthouses." })).status, 400);

  setAiBinding({ run: async (model: string, input: any) => (imageRuns.push({ model, input }), imageResult()) });
  assert.equal((await call("owner", "GET", "/ai/image")).body.available, true);

  aiText = '"A lighthouse at dawn, waves below."';
  const before = chatCalls().length;
  const r = await call("owner", "POST", "/ai/image", { content: "We kept the lights on during the outage. Here's how.", style: "illustration" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.prompt, "A lighthouse at dawn, waves below.");
  assert.match(r.body.dataUrl, /^data:image\/jpeg;base64,\/9j\//);
  assert.equal(chatCalls().length, before + 1);
  assert.match(chatCalls().at(-1)!.body.messages.at(-1).content, /<post>[\s\S]*kept the lights on/);
  // FLUX.2 klein takes a multipart form.
  assert.equal(imageRuns.at(-1)!.model, IMAGE_MODEL_IDS.better);
  const fields = await sent(imageRuns.at(-1)!);
  assert.match(fields.prompt, /^A lighthouse at dawn, waves below\. Flat vector illustration.*No text, no letters/);
  assert.equal(fields.width, "1024");
  assert.equal(fields.height, "1024");

  // "Fast" uses FLUX.1 schnell with JSON input; your own description skips the AI writing step.
  const own = await call("owner", "POST", "/ai/image", { prompt: "A red bicycle against a white wall", style: "photo", model: "fast" });
  assert.equal(own.status, 200);
  assert.equal(chatCalls().length, before + 1, "no AI writing call when you describe the image");
  assert.equal(imageRuns.at(-1)!.model, IMAGE_MODEL_IDS.fast);
  assert.equal(imageRuns.at(-1)!.input.steps, 8);
  assert.match(imageRuns.at(-1)!.input.prompt, /^A red bicycle against a white wall\. Editorial photograph/);

  assert.equal((await call("owner", "POST", "/ai/image", { prompt: "x", style: "oil-painting" })).status, 400);
  assert.equal((await call("owner", "POST", "/ai/image", { prompt: "x", model: "dall-e" })).status, 400);

  imageResult = async () => {
    throw new Error("3040: capacity");
  };
  const failed = await call("owner", "POST", "/ai/image", { prompt: "A cat" });
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /Image generation failed: 3040: capacity/);
  imageResult = okImage;
});

test("FLUX.2's safety filter: a flagged image is retried once; flagged twice gives a clear message", async () => {
  const flagged = async () => {
    throw new Error("3030: Your output has been flagged. Please choose another prompt / input image combination");
  };
  let n = 0;
  imageResult = () => (n++ === 0 ? flagged() : okImage());
  const runs = imageRuns.length;
  const ok = await call("owner", "POST", "/ai/image", { prompt: "A team at a whiteboard" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(imageRuns.length, runs + 2, "retried once");

  imageResult = flagged;
  const r = await call("owner", "POST", "/ai/image", { prompt: "A team at a whiteboard" });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /safety filter blocked this one.*switch to Fast/);
  assert.equal(imageRuns.length, runs + 4, "no more than one retry");
  imageResult = okImage;
});

test("AI image allowance: other accounts get a daily image limit, checked before any AI writing", async () => {
  await db.run("DELETE FROM ai_usage WHERE user_id = 'other'");
  assert.equal((await call("other", "POST", "/ai/image", { prompt: "A mountain" })).status, 200);
  const before = chatCalls().length;
  const runs = imageRuns.length;
  const r = await call("other", "POST", "/ai/image", { content: "A long enough post about mountains and climbing." });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /today's 1 images/);
  assert.equal(chatCalls().length, before, "no writing request spent");
  assert.equal(imageRuns.length, runs);
  setAiBinding(undefined);
});

test("your hashtags: most used from published and queued posts (not drafts); sets are saved cleaned and per account", async () => {
  const mk = async (content: string, status: string) => {
    const { body } = await call("owner", "POST", "/posts", { content });
    await db.run("UPDATE posts SET status = ? WHERE id = ?", status, body.id);
  };
  await mk("One\n\n#Leadership #AI", "published");
  await mk("Two\n\n#leadership #Startups", "published");
  await mk("Three #Leadership in text", "queued");
  await mk("Draft\n\n#NeverCounted", "draft");

  const mine = (await call("owner", "GET", "/hashtags")).body;
  assert.deepEqual(mine.frequent, [
    { tag: "#Leadership", count: 3 },
    { tag: "#AI", count: 1 },
    { tag: "#Startups", count: 1 },
  ]);
  assert.deepEqual(mine.sets, []);

  const saved = await call("owner", "POST", "/hashtags/sets", { name: " My usual ", tags: ["#Leadership", "leadership", "remote work", "#!!"] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.sets.length, 1);
  assert.deepEqual(saved.body.sets[0].name, "My usual");
  assert.deepEqual(saved.body.sets[0].tags, ["#Leadership", "#RemoteWork"]);

  assert.equal((await call("owner", "POST", "/hashtags/sets", { name: "x", tags: ["!!"] })).status, 400);
  assert.equal((await call("owner", "POST", "/hashtags/sets", { name: "", tags: ["#A"] })).status, 400);
  const many = Array.from({ length: 16 }, (_, i) => `#Tag${i}`);
  assert.match((await call("owner", "POST", "/hashtags/sets", { name: "big", tags: many })).body.error, /at most 15/);

  // Other accounts can't see or delete it.
  const id = saved.body.sets[0].id;
  assert.deepEqual((await call("friend", "GET", "/hashtags")).body, { frequent: [], sets: [] });
  await call("friend", "DELETE", `/hashtags/sets/${id}`);
  assert.equal((await call("owner", "GET", "/hashtags")).body.sets.length, 1);
  assert.deepEqual((await call("owner", "DELETE", `/hashtags/sets/${id}`)).body.sets, []);
});
