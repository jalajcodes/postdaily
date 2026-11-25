import { Hono } from "hono";
import { z } from "zod";
import { LINKEDIN_MAX_CHARS, MAX_IMAGE_BYTES } from "@postdaily/shared";
import { db, newId, nowIso } from "../db";
import { getPost, toPost } from "../repo";
import { nextFreeSlot, publishNow, schedulePost } from "../lib/schedule";
import type { AppEnv } from "../lib/auth";

export const posts = new Hono<AppEnv>();

posts.get("/posts", async (c) => {
  const status = c.req.query("status");
  const order = status === "queued" ? "scheduled_at ASC" : status === "published" ? "published_at DESC" : "updated_at DESC";
  const rows = status
    ? await db.all(`SELECT * FROM posts WHERE user_id = ? AND status = ? ORDER BY ${order}`, c.get("userId"), status)
    : await db.all(`SELECT * FROM posts WHERE user_id = ? ORDER BY ${order}`, c.get("userId"));
  return c.json(rows.map(toPost));
});

posts.get("/posts/:id", async (c) => {
  const p = await getPost(c.get("userId"), c.req.param("id"));
  return p ? c.json(p) : c.json({ error: "Not found" }, 404);
});

posts.post("/posts", async (c) => {
  const body = z.object({ content: z.string(), ideaId: z.string().nullish() }).parse(await c.req.json());
  const id = newId();
  await db.run(
    "INSERT INTO posts (id, user_id, content, idea_id) VALUES (?, ?, ?, ?)",
    id,
    c.get("userId"),
    body.content,
    body.ideaId ?? null,
  );
  return c.json(await getPost(c.get("userId"), id));
});

posts.patch("/posts/:id", async (c) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const p = await getPost(uid, id);
  if (!p) return c.json({ error: "Not found" }, 404);
  if (p.status === "published" || p.status === "publishing")
    return c.json({ error: "Published posts can't be edited here" }, 400);
  const body = z
    .object({
      content: z.string().optional(),
      scheduledAt: z.string().datetime({ offset: true }).nullish(),
      jitter: z.boolean().optional(),
      firstComment: z.string().max(1250, "LinkedIn comments are limited to 1,250 characters").nullish(),
      imageAlt: z.string().max(4000).nullish(),
    })
    .parse(await c.req.json());
  if (body.content !== undefined) await db.run("UPDATE posts SET content = ? WHERE id = ?", body.content, id);
  if (body.firstComment !== undefined)
    await db.run("UPDATE posts SET first_comment = ? WHERE id = ?", body.firstComment?.trim() || null, id);
  if (body.imageAlt !== undefined) await db.run("UPDATE posts SET image_alt = ? WHERE id = ?", body.imageAlt?.trim() || null, id);
  if (body.scheduledAt) {
    if (new Date(body.scheduledAt) <= new Date()) return c.json({ error: "Pick a time in the future" }, 400);
    await schedulePost(uid, id, body.scheduledAt, body.jitter);
  } else if (body.scheduledAt === null) {
    await db.run("UPDATE posts SET scheduled_at=NULL, publish_at=NULL, jitter_minutes=0, status='draft' WHERE id=?", id);
  } else if (body.jitter !== undefined && p.status === "queued" && p.scheduledAt) {
    // Toggle the random buffer on an already-queued post: recompute its publish time.
    await schedulePost(uid, id, p.scheduledAt, body.jitter);
  }
  await db.run("UPDATE posts SET updated_at = ? WHERE id = ?", nowIso(), id);
  return c.json(await getPost(uid, id));
});

// --- Image (one per post), stored as a data URL; resized in the browser first ---
posts.get("/posts/:id/image", async (c) => {
  const row = await db.get<{ data_url: string }>(
    "SELECT i.data_url FROM post_images i JOIN posts p ON p.id = i.post_id WHERE i.post_id = ? AND p.user_id = ?",
    c.req.param("id"),
    c.get("userId"),
  );
  return row ? c.json({ dataUrl: row.data_url }) : c.json({ error: "No image" }, 404);
});

posts.put("/posts/:id/image", async (c) => {
  const uid = c.get("userId");
  const p = await getPost(uid, c.req.param("id"));
  if (!p) return c.json({ error: "Not found" }, 404);
  if (p.status === "published" || p.status === "publishing") return c.json({ error: "Post is already published" }, 400);
  const { dataUrl, alt } = z
    .object({
      dataUrl: z
        .string()
        .regex(/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/, "Unsupported image")
        .max(Math.ceil(MAX_IMAGE_BYTES * 1.37) + 100, "Image is too large. Try a smaller one."),
      alt: z.string().max(4000).optional(),
    })
    .parse(await c.req.json());
  await db.batch([
    {
      sql: "INSERT INTO post_images (post_id, data_url) VALUES (?, ?) ON CONFLICT(post_id) DO UPDATE SET data_url = excluded.data_url",
      params: [p.id, dataUrl],
    },
    {
      sql: "UPDATE posts SET has_image = 1, image_alt = COALESCE(?, image_alt), updated_at = ? WHERE id = ?",
      params: [alt?.trim() || null, nowIso(), p.id],
    },
  ]);
  return c.json(await getPost(uid, p.id));
});

posts.delete("/posts/:id/image", async (c) => {
  const uid = c.get("userId");
  const p = await getPost(uid, c.req.param("id"));
  if (!p) return c.json({ error: "Not found" }, 404);
  await db.batch([
    { sql: "DELETE FROM post_images WHERE post_id = ?", params: [p.id] },
    { sql: "UPDATE posts SET has_image = 0, image_alt = NULL, updated_at = ? WHERE id = ?", params: [nowIso(), p.id] },
  ]);
  return c.json(await getPost(uid, p.id));
});

posts.delete("/posts/:id", async (c) => {
  await db.run("DELETE FROM posts WHERE id = ? AND user_id = ?", c.req.param("id"), c.get("userId"));
  return c.json({ ok: true });
});

function validateForPosting(content: string) {
  if (!content.trim()) return "Post is empty";
  if (content.length > LINKEDIN_MAX_CHARS) return `LinkedIn allows ${LINKEDIN_MAX_CHARS} characters; this has ${content.length}`;
  return null;
}

posts.post("/posts/:id/queue", async (c) => {
  const uid = c.get("userId");
  const p = await getPost(uid, c.req.param("id"));
  if (!p) return c.json({ error: "Not found" }, 404);
  const { jitter } = z.object({ jitter: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
  const invalid = validateForPosting(p.content);
  if (invalid) return c.json({ error: invalid }, 400);
  const slot = await nextFreeSlot(uid);
  if (!slot) return c.json({ error: "Add at least one weekly posting slot first" }, 400);
  await schedulePost(uid, p.id, slot, jitter);
  return c.json(await getPost(uid, p.id));
});

posts.post("/posts/:id/unschedule", async (c) => {
  const uid = c.get("userId");
  await db.run(
    "UPDATE posts SET status='draft', scheduled_at=NULL, publish_at=NULL, jitter_minutes=0, retry_count=0, error=NULL, updated_at=? WHERE id=? AND user_id=? AND status IN ('queued','failed')",
    nowIso(),
    c.req.param("id"),
    uid,
  );
  return c.json(await getPost(uid, c.req.param("id")));
});

// Retry a failed post right away (resets the automatic-retry counter).
posts.post("/posts/:id/retry", async (c) => {
  const uid = c.get("userId");
  const p = await getPost(uid, c.req.param("id"));
  if (!p) return c.json({ error: "Not found" }, 404);
  if (p.status !== "failed") return c.json({ error: "Only failed posts can be retried" }, 400);
  await db.run("UPDATE posts SET retry_count = 0 WHERE id = ?", p.id);
  const result = await publishNow(uid, p.id);
  if (result.status === "failed") return c.json({ error: result.error }, 502);
  return c.json(result);
});

posts.post("/posts/:id/publish", async (c) => {
  const uid = c.get("userId");
  const p = await getPost(uid, c.req.param("id"));
  if (!p) return c.json({ error: "Not found" }, 404);
  const invalid = validateForPosting(p.content);
  if (invalid) return c.json({ error: invalid }, 400);
  const result = await publishNow(uid, p.id);
  if (result.status === "failed") return c.json({ error: result.error }, 502);
  return c.json(result);
});
