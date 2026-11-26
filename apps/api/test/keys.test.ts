// API keys added in Settings: checked with the provider, stored encrypted, never sent back,
// used for that user's AI calls (requests and background jobs), with the server key as fallback.
// Real HTTP app + real DB; only the providers' HTTP endpoints are faked.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createApp } from "../src/app";
import { createSession } from "../src/lib/auth";
import { db } from "../src/db";
import { env, setEnv } from "../src/runtime/env";
import { runScheduledTick } from "../src/scheduler";
import { aiReply, createUser, json, setup } from "./helpers";

let t: Awaited<ReturnType<typeof setup>>;
const app = createApp();
const tokens: Record<string, string> = {};
const SECRET = "test-keys-secret-0123456789abcdef";
const USER_KEY = "sk-or-v1-user1aaaaaaaaaaaaaaaaaaaaaaaaaaaaWXYZ";
const VALID = new Set([USER_KEY, "sk-or-v1-user2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);

async function call(user: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`http://test.local/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokens[user]}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}

/** The Authorization header of the most recent chat completion call. */
const lastChatAuth = () => t.calls.filter((c) => c.url.endsWith("/chat/completions")).at(-1)?.headers.authorization;
const rewrite = (user: string) => call(user, "POST", "/ai/rewrite", { content: "Some post", action: "shorter" });
const keyRows = () => db.all<{ user_id: string; provider: string; ciphertext: string; iv: string; last4: string }>("SELECT * FROM api_keys");

before(async () => {
  t = await setup({ KEYS_SECRET: SECRET }); // the server also has OPENROUTER_API_KEY=test
  t.route((c) => {
    if (c.url === "https://openrouter.ai/api/v1/key")
      return VALID.has(c.headers.authorization?.slice(7) ?? "") ? json({ data: { label: "x" } }) : json({ error: { message: "No auth" } }, 401);
    if (c.url.endsWith("/chat/completions")) return aiReply("Shorter post");
    if (c.url.startsWith("https://api.anthropic.com/v1/models"))
      return json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
    return undefined;
  });
  for (const u of ["u1", "u2"]) {
    await createUser(u);
    tokens[u] = await createSession(u);
  }
});

test("bad format and keys the provider rejects are not saved", async () => {
  t.calls.length = 0;
  for (const [provider, key, msg] of [
    ["openrouter", "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx", /start with "sk-or-"/],
    ["openrouter", "short", /doesn't look like/],
    ["openrouter", "sk-or-v1-has space inside xxxxxxxxxx", /doesn't look like/],
    ["openai", "sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx", /not an OpenAI key/],
  ] as const) {
    const r = await call("u1", "PUT", `/settings/keys/${provider}`, { key });
    assert.equal(r.status, 400, key);
    assert.match(r.body.error, msg);
  }
  assert.equal(t.calls.length, 0, "badly formatted keys never reach the provider");

  const wrong = await call("u1", "PUT", "/settings/keys/openrouter", { key: "sk-or-v1-wrongwrongwrongwrongwrongwrong" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /didn't accept this key/);

  const anth = await call("u1", "PUT", "/settings/keys/anthropic", { key: "sk-ant-api03-revokedrevokedrevokedrevoked" });
  assert.equal(anth.status, 400, anth.text);
  assert.match(anth.body.error, /Anthropic didn't accept/);
  assert.ok(t.find((c) => c.url.startsWith("https://api.anthropic.com/v1/models") && c.headers.authorization === "Bearer sk-ant-api03-revokedrevokedrevokedrevoked"));

  assert.equal((await call("u1", "PUT", "/settings/keys/gemini", { key: "sk-xxxxxxxxxxxxxxxxxxxxxxxx" })).status, 400);
  assert.equal((await keyRows()).length, 0);
});

test("a valid key is stored encrypted, shown masked, and used for that user's AI calls only", async () => {
  // Before: everyone uses the server's key.
  await rewrite("u1");
  assert.equal(lastChatAuth(), "Bearer test");

  const r = await call("u1", "PUT", "/settings/keys/openrouter", { key: `  ${USER_KEY}\n` });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.keys.map((k: any) => [k.provider, k.last4]), [["openrouter", "WXYZ"]]);
  assert.equal(r.body.canStore, true);
  assert.deepEqual(r.body.server, { openrouter: true, anthropic: false, openai: false });
  assert.ok(!r.text.includes(USER_KEY.slice(0, 20)), "the key is never sent back");
  assert.ok(!(await call("u1", "GET", "/settings/keys")).text.includes(USER_KEY.slice(0, 20)));

  const [row] = await keyRows();
  assert.equal(row.user_id, "u1");
  assert.equal(row.last4, "WXYZ");
  assert.ok(!row.ciphertext.includes(USER_KEY) && !Buffer.from(row.ciphertext, "base64").toString("latin1").includes("sk-or"), "stored encrypted");

  // u1's requests use u1's key; u2 still uses the server key.
  await rewrite("u1");
  assert.equal(lastChatAuth(), `Bearer ${USER_KEY}`);
  await rewrite("u2");
  assert.equal(lastChatAuth(), "Bearer test");
  const u2keys = await call("u2", "GET", "/settings/keys");
  assert.deepEqual(u2keys.body.keys, []);

  const statuses = (await call("u1", "GET", "/ai/providers")).body;
  assert.equal(statuses.find((s: any) => s.id === "openrouter").note, "Using your key (…WXYZ)");
  assert.equal((await call("u2", "GET", "/ai/providers")).body.find((s: any) => s.id === "openrouter").note, "Using the server's key");
});

test("background jobs (style refresh) use the user's own key", async () => {
  await db.run("UPDATE profiles SET style_refresh_due = 1, sample_posts = ? WHERE user_id = 'u1'", "x".repeat(300));
  t.calls.length = 0;
  await runScheduledTick();
  const chats = t.calls.filter((c) => c.url.endsWith("/chat/completions"));
  assert.equal(chats.length, 1, "style refresh ran");
  assert.equal(chats[0].headers.authorization, `Bearer ${USER_KEY}`);
});

test("a row copied to another user, or a changed KEYS_SECRET, doesn't decrypt: falls back to the server key", async () => {
  const [row] = await keyRows();
  await db.run(
    "INSERT INTO api_keys (user_id, provider, ciphertext, iv, last4) VALUES ('u2', 'openrouter', ?, ?, ?)",
    row.ciphertext,
    row.iv,
    row.last4,
  );
  await rewrite("u2");
  assert.equal(lastChatAuth(), "Bearer test");
  await db.run("DELETE FROM api_keys WHERE user_id = 'u2'");

  const saved = { KEYS_SECRET: SECRET, OPENROUTER_API_KEY: "test", RUNTIME: "node" };
  setEnv({ ...saved, KEYS_SECRET: "a-completely-different-secret-value" });
  try {
    await rewrite("u1");
    assert.equal(lastChatAuth(), "Bearer test");
  } finally {
    setEnv(saved);
  }
});

test("removing the key goes back to the server key", async () => {
  const r = await call("u1", "DELETE", "/settings/keys/openrouter");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.keys, []);
  assert.equal((await keyRows()).length, 0);
  await rewrite("u1");
  assert.equal(lastChatAuth(), "Bearer test");
});

test("without KEYS_SECRET keys can't be saved, and with no key at all the error says where to add one", async () => {
  const saved = { KEYS_SECRET: SECRET, OPENROUTER_API_KEY: "test", RUNTIME: "node" };
  setEnv({ RUNTIME: "node" });
  try {
    assert.equal(env("KEYS_SECRET"), undefined);
    const s = await call("u1", "GET", "/settings/keys");
    assert.equal(s.body.canStore, false);
    t.calls.length = 0;
    const r = await call("u1", "PUT", "/settings/keys/openrouter", { key: USER_KEY });
    assert.equal(r.status, 503);
    assert.match(r.body.error, /KEYS_SECRET/);
    assert.equal(t.calls.length, 0);
    const w = await rewrite("u1");
    assert.match(w.body.error, /Add an OpenRouter API key in Settings/);
  } finally {
    setEnv(saved);
  }
});
