// Background jobs: engagement nudge, LinkedIn expiry warnings, Web Push delivery.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db } from "../src/db";
import { runScheduledTick } from "../src/scheduler";
import { createUser, setup } from "./helpers";

let t: Awaited<ReturnType<typeof setup>>;
let keys: CryptoKeyPair;
let publicKey: string;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const titles = async (userId: string) =>
  (await db.all<{ title: string }>("SELECT title FROM notifications WHERE user_id = ? ORDER BY created_at", userId)).map((n) => n.title);

before(async () => {
  keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64url");
  const { d } = await crypto.subtle.exportKey("jwk", keys.privateKey);
  t = await setup({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: d!, VAPID_SUBJECT: "mailto:t@t.test" });
  t.route((c) => (c.url.startsWith("https://push.test/") ? new Response(null, { status: c.url.includes("gone") ? 410 : 201 }) : undefined));
  await createUser("u1");
  await createUser("u2"); // nudges turned off
  await db.run("UPDATE settings SET engagement_nudge = 0 WHERE user_id = 'u2'");
});

test("nudges ~40 minutes after publishing, once, and only for recent posts of users who want it", async () => {
  const add = (id: string, user: string, publishedAt: string) =>
    db.run(
      "INSERT INTO posts (id, user_id, content, status, published_at) VALUES (?, ?, ?, 'published', ?)",
      id,
      user,
      `First line of ${id}\nmore`,
      publishedAt,
    );
  await add("fresh", "u1", minutesAgo(10)); // too early
  await add("due", "u1", minutesAgo(45)); // nudge
  await add("old", "u1", minutesAgo(300)); // too old (e.g. after downtime)
  await add("off", "u2", minutesAgo(45)); // user turned nudges off

  await runScheduledTick();
  const notes = await db.all<{ body: string }>("SELECT body FROM notifications WHERE title = 'Reply to comments now'");
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /First line of due/);
  assert.equal((await db.get<{ nudge_sent: number }>("SELECT nudge_sent FROM posts WHERE id = 'fresh'"))!.nudge_sent, 0);
  assert.equal((await db.get<{ nudge_sent: number }>("SELECT nudge_sent FROM posts WHERE id = 'old'"))!.nudge_sent, 1);

  await runScheduledTick();
  assert.equal((await db.all("SELECT 1 FROM notifications WHERE title = 'Reply to comments now'")).length, 1, "not repeated");
  assert.ok(!(await titles("u2")).includes("Reply to comments now"));
});

test("warns 7 days before LinkedIn expires, once, then again when it has expired", async () => {
  await db.run("UPDATE users SET linkedin_expires_at = ? WHERE id = 'u1'", new Date(Date.now() + 3 * 86_400_000).toISOString());
  await runScheduledTick();
  await runScheduledTick();
  assert.equal((await titles("u1")).filter((x) => x === "Reconnect LinkedIn soon").length, 1);

  await db.run("UPDATE users SET linkedin_expires_at = ? WHERE id = 'u1'", minutesAgo(1));
  await runScheduledTick();
  assert.ok((await titles("u1")).includes("LinkedIn disconnected"));
});

test("push: signed VAPID request with no body, and dead subscriptions are removed", async () => {
  await db.run("INSERT INTO push_subscriptions (id, user_id, endpoint) VALUES ('s1','u1','https://push.test/ok'), ('s2','u1','https://push.test/gone')");
  t.calls.length = 0;
  const { addNotification } = await import("../src/repo");
  await addNotification("u1", "Hello", "World");

  const push = t.find((c) => c.url === "https://push.test/ok")!;
  const m = push.headers["authorization"].match(/^vapid t=([^,]+), k=(.+)$/)!;
  assert.ok(m, "vapid header");
  const [h, p, s] = m[1].split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.aud, "https://push.test");
  assert.equal(m[2], publicKey);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    keys.publicKey,
    Buffer.from(s, "base64url"),
    new TextEncoder().encode(`${h}.${p}`),
  );
  assert.ok(ok, "JWT signature verifies");
  assert.equal(push.headers["content-length"], "0");
  assert.ok(push.headers["ttl"]);
  assert.equal(await db.get("SELECT 1 FROM push_subscriptions WHERE id = 's2'"), undefined);
});
