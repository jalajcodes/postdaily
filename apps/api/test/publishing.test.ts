// Publishing to LinkedIn: retries, media, first comment, style learning.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db } from "../src/db";
import { getProfile } from "../src/repo";
import { publishNow } from "../src/lib/schedule";
import { aiReply, createUser, fakeLinkedIn, setup } from "./helpers";

let t: Awaited<ReturnType<typeof setup>>;
let li: { postStatus: number; docStatus?: string };
const png = "data:image/png;base64," + Buffer.from("fakepngbytes").toString("base64");
const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 fake").toString("base64");

async function addPost(id: string, fields: Record<string, string | number | null> = {}) {
  const cols = { id, user_id: "u1", content: `Post ${id}`, status: "queued", ...fields };
  await db.run(
    `INSERT INTO posts (${Object.keys(cols).join(", ")}) VALUES (${Object.keys(cols).map(() => "?").join(", ")})`,
    ...Object.values(cols),
  );
}
const row = (id: string) => db.get("SELECT * FROM posts WHERE id = ?", id) as Promise<Record<string, any>>;

before(async () => {
  t = await setup();
  li = fakeLinkedIn(t);
  await createUser("u1");
});

test("a temporary LinkedIn error queues an automatic retry in 5 minutes", async () => {
  await addPost("tmp");
  li.postStatus = 503;
  const r = await publishNow("u1", "tmp");
  const p = await row("tmp");
  assert.equal(r.status, "queued");
  assert.equal(p.retry_count, 1);
  const delayMin = (new Date(p.publish_at).getTime() - Date.now()) / 60_000;
  assert.ok(delayMin > 4.5 && delayMin < 5.5, `delay ${delayMin}`);
  assert.match(r.error ?? "", /temporary problem \(503\)/);
  li.postStatus = 201;
});

test("a permanent error fails right away; repeated temporary errors fail after 3 retries", async () => {
  await addPost("perm");
  li.postStatus = 422;
  assert.equal((await publishNow("u1", "perm")).status, "failed");

  await addPost("rl");
  li.postStatus = 429;
  let r;
  for (let i = 0; i < 4; i++) r = await publishNow("u1", "rl");
  assert.equal(r!.status, "failed");
  li.postStatus = 201;
});

test("publishes with an image, alt text, escaped text and a first comment", async () => {
  await addPost("img", { content: "Hello (world) #ship", first_comment: "Link: https://e.test", has_image: 1, media_type: "image", image_alt: "alt text" });
  await db.run("INSERT INTO post_images (post_id, data_url) VALUES ('img', ?)", png);
  t.calls.length = 0;

  const r = await publishNow("u1", "img");
  assert.equal(r.status, "published");
  assert.equal(r.linkedinUrn, "urn:li:share:111");

  const put = t.find((c) => c.url === "https://upload.test/img")!;
  assert.equal(put.headers["content-type"], "image/png");
  assert.equal(Buffer.from(put.body).toString(), "fakepngbytes");

  const post = t.find((c) => c.url.endsWith("/rest/posts"))!;
  assert.deepEqual(post.body.content.media, { id: "urn:li:image:IMG1", altText: "alt text" });
  assert.equal(post.body.commentary, "Hello \\(world\\) {hashtag|\\#|ship}");

  const comment = t.find((c) => c.url.includes("/socialActions/"))!;
  assert.ok(comment.url.includes(encodeURIComponent("urn:li:share:111")));
  assert.equal(comment.body.message.text, "Link: https://e.test");
  assert.equal(comment.body.actor, "urn:li:person:SUB_u1");
  assert.ok((await row("img")).comment_urn);
});

test("publishes a PDF carousel through the Documents API, waiting until it's processed", async () => {
  await addPost("doc", { has_image: 1, media_type: "document", document_title: "5 lessons" });
  await db.run("INSERT INTO post_images (post_id, data_url) VALUES ('doc', ?)", pdf);
  li.docStatus = "AVAILABLE";
  t.calls.length = 0;

  const r = await publishNow("u1", "doc");
  assert.equal(r.status, "published");
  const put = t.find((c) => c.url === "https://upload.test/doc")!;
  assert.equal(put.headers["content-type"], "application/pdf");
  assert.equal(Buffer.from(put.body).toString(), "%PDF-1.4 fake");
  assert.ok(t.find((c) => c.url.includes("/rest/documents/" + encodeURIComponent("urn:li:document:DOC1"))));
  const post = t.find((c) => c.url.endsWith("/rest/posts"))!;
  assert.deepEqual(post.body.content.media, { id: "urn:li:document:DOC1", title: "5 lessons" });
  assert.equal(t.calls.filter((c) => c.url.includes("/rest/images")).length, 0);
});

test("a carousel LinkedIn can't process fails the post instead of posting without it", async () => {
  await addPost("baddoc", { has_image: 1, media_type: "document", document_title: "x" });
  await db.run("INSERT INTO post_images (post_id, data_url) VALUES ('baddoc', ?)", pdf);
  li.docStatus = "PROCESSING_FAILED";
  t.calls.length = 0;
  const r = await publishNow("u1", "baddoc");
  assert.equal(r.status, "failed");
  assert.match(r.error ?? "", /couldn't process the carousel/);
  assert.equal(t.calls.filter((c) => c.url.endsWith("/rest/posts")).length, 0);
  li.docStatus = "AVAILABLE";
});

test("published posts become voice examples, and every 5th publish flags a style refresh", async () => {
  await db.run("UPDATE profiles SET learned_posts = '[]', style_refresh_due = 0 WHERE user_id = 'u1'");
  const before = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'"))!.n;
  const toFifth = 5 - (before % 5);
  for (let i = 0; i < toFifth; i++) {
    await addPost(`l${i}`, { content: `learned ${i}` });
    await publishNow("u1", `l${i}`);
  }
  const prof = (await db.get<{ style_refresh_due: number; learned_posts: string }>(
    "SELECT style_refresh_due, learned_posts FROM profiles WHERE user_id = 'u1'",
  ))!;
  assert.equal(prof.style_refresh_due, 1);
  assert.equal(JSON.parse(prof.learned_posts)[0], `learned ${toFifth - 1}`);
  assert.equal((await getProfile("u1")).learnedCount, toFifth);
});

test("the scheduler re-learns the style guide when a refresh is due", async () => {
  await db.run("UPDATE profiles SET style_refresh_due = 1, sample_posts = ? WHERE user_id = 'u1'", "x".repeat(300));
  t.route((c) => (c.url.endsWith("/chat/completions") ? aiReply({ styleGuide: "- Learned guide", topics: ["shipping"] }) : undefined));
  const { runScheduledTick } = await import("../src/scheduler");
  await runScheduledTick();
  assert.equal((await getProfile("u1")).styleGuide, "- Learned guide");
});
