import { Hono } from "hono";
import { z } from "zod";
import { LINKEDIN_MAX_CHARS } from "@postdaily/shared";
import { db, newId, nowIso } from "../db";
import { getPost, toPost } from "../repo";
import { nextFreeSlot, publishNow } from "../lib/schedule";
import type { AppEnv } from "../lib/auth";

export const posts = new Hono<AppEnv>();

posts.get("/posts", (c) => {
  const status = c.req.query("status");
  const order = status === "queued" ? "scheduled_at ASC" : status === "published" ? "published_at DESC" : "updated_at DESC";
  const rows = status
    ? db.prepare(`SELECT * FROM posts WHERE user_id = ? AND status = ? ORDER BY ${order}`).all(c.get("userId"), status)
    : db.prepare(`SELECT * FROM posts WHERE user_id = ? ORDER BY ${order}`).all(c.get("userId"));
  return c.json((rows as any[]).map(toPost));
});

posts.get("/posts/:id", (c) => {
  const p = getPost(c.get("userId"), c.req.param("id"));
  return p ? c.json(p) : c.json({ error: "Not found" }, 404);
});

posts.post("/posts", async (c) => {
  const body = z.object({ content: z.string(), ideaId: z.string().nullish() }).parse(await c.req.json());
  const id = newId();
  db.prepare("INSERT INTO posts (id, user_id, content, idea_id) VALUES (?, ?, ?, ?)").run(
    id,
    c.get("userId"),
    body.content,
    body.ideaId ?? null,
  );
  return c.json(getPost(c.get("userId"), id));
});

posts.patch("/posts/:id", async (c) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const p = getPost(uid, id);
  if (!p) return c.json({ error: "Not found" }, 404);
  if (p.status === "published") return c.json({ error: "Published posts can't be edited here" }, 400);
  const body = z
    .object({ content: z.string().optional(), scheduledAt: z.string().datetime({ offset: true }).nullish() })
    .parse(await c.req.json());
  if (body.content !== undefined) db.prepare("UPDATE posts SET content = ? WHERE id = ?").run(body.content, id);
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt && new Date(body.scheduledAt) <= new Date())
      return c.json({ error: "Pick a time in the future" }, 400);
    db.prepare("UPDATE posts SET scheduled_at = ?, status = ?, error = NULL WHERE id = ?").run(
      body.scheduledAt ? new Date(body.scheduledAt).toISOString() : null,
      body.scheduledAt ? "queued" : "draft",
      id,
    );
  }
  db.prepare("UPDATE posts SET updated_at = ? WHERE id = ?").run(nowIso(), id);
  return c.json(getPost(uid, id));
});

posts.delete("/posts/:id", (c) => {
  db.prepare("DELETE FROM posts WHERE id = ? AND user_id = ?").run(c.req.param("id"), c.get("userId"));
  return c.json({ ok: true });
});

function validateForPosting(content: string) {
  if (!content.trim()) return "Post is empty";
  if (content.length > LINKEDIN_MAX_CHARS) return `LinkedIn allows ${LINKEDIN_MAX_CHARS} characters; this has ${content.length}`;
  return null;
}

posts.post("/posts/:id/queue", (c) => {
  const uid = c.get("userId");
  const p = getPost(uid, c.req.param("id"));
  if (!p) return c.json({ error: "Not found" }, 404);
  const invalid = validateForPosting(p.content);
  if (invalid) return c.json({ error: invalid }, 400);
  const slot = nextFreeSlot(uid);
  if (!slot) return c.json({ error: "Add at least one weekly posting slot first" }, 400);
  db.prepare("UPDATE posts SET status='queued', scheduled_at=?, error=NULL, updated_at=? WHERE id=?").run(slot, nowIso(), p.id);
  return c.json(getPost(uid, p.id));
});

posts.post("/posts/:id/unschedule", (c) => {
  const uid = c.get("userId");
  db.prepare("UPDATE posts SET status='draft', scheduled_at=NULL, updated_at=? WHERE id=? AND user_id=? AND status IN ('queued','failed')").run(
    nowIso(),
    c.req.param("id"),
    uid,
  );
  return c.json(getPost(uid, c.req.param("id")));
});

posts.post("/posts/:id/publish", async (c) => {
  const uid = c.get("userId");
  const p = getPost(uid, c.req.param("id"));
  if (!p) return c.json({ error: "Not found" }, 404);
  const invalid = validateForPosting(p.content);
  if (invalid) return c.json({ error: invalid }, 400);
  const result = await publishNow(uid, p.id);
  if (result.status === "failed") return c.json({ error: result.error }, 502);
  return c.json(result);
});
