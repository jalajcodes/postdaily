// Hashtag suggestions for a post. Real HTTP app + real DB; only the AI's HTTP endpoint is faked.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createApp } from "../src/app";
import { createSession } from "../src/lib/auth";
import { aiReply, createUser, setup } from "./helpers";

let t: Awaited<ReturnType<typeof setup>>;
let token: string;
const app = createApp();
let reply: unknown = {};

async function suggest(content: string) {
  const res = await app.request("http://test.local/api/ai/hashtags", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

before(async () => {
  t = await setup();
  t.route((c) => (c.url.endsWith("/chat/completions") ? aiReply(reply) : undefined));
  await createUser("u1");
  token = await createSession("u1");
});

test("suggests cleaned-up hashtags, broad first, skipping ones the post already has", async () => {
  reply = {
    hashtags: [
      { tag: "#ProductManagement", kind: "niche" },
      { tag: "leadership", kind: "broad" },
      { tag: "#remote work", kind: "niche" },
      { tag: "#AI", kind: "broad" }, // already in the post
      { tag: "#Leadership", kind: "niche" }, // duplicate
      { tag: "#!!", kind: "niche" }, // nothing usable
      "#BuildInPublic", // plain string still accepted
    ],
  };
  const post = "We shipped our first #AI feature in 6 weeks. Here's what the PM role looked like.";
  const r = await suggest(post);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.hashtags, [
    { tag: "#Leadership", kind: "broad" },
    { tag: "#ProductManagement", kind: "niche" },
    { tag: "#RemoteWork", kind: "niche" },
    { tag: "#BuildInPublic", kind: "niche" },
  ]);
  const sent = t.calls.filter((c) => c.url.endsWith("/chat/completions")).at(-1)!;
  const prompt = sent.body.messages.map((m: any) => m.content).join("\n");
  assert.match(prompt, /<post>[\s\S]*first #AI feature/);
  assert.match(prompt, /"broad"/);
});

test("needs some text first, and a bad AI reply is a clear error", async () => {
  assert.equal((await suggest("too short")).status, 400);
  reply = "Sorry, here are some: #a #b";
  const r = await suggest("A long enough post about hiring and culture.");
  assert.equal(r.status, 502);
  assert.match(r.body.error, /not valid JSON/);
});
