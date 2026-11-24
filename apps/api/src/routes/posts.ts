import { Hono } from "hono";
import { z } from "zod";
import { LINKEDIN_MAX_CHARS } from "@postdaily/shared";
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
    })
    .parse(await c.req.json());
  if (body.content !== undefined) await db.run("UPDATE posts SET content = ? WHERE id = ?", body.content, id);
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
    "UPDATE posts SET status='draft', scheduled_at=NULL, publish_at=NULL, jitter_minutes=0, updated_at=? WHERE id=? AND user_id=? AND status IN ('queued','failed')",
    nowIso(),
    c.req.param("id"),
    uid,
  );
  return c.json(await getPost(uid, c.req.param("id")));
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
