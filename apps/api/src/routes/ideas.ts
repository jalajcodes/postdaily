import { Hono } from "hono";
import { DateTime } from "luxon";
import { z } from "zod";
import { db, newId } from "../db";
import { getProfile, getSettings, toIdea } from "../repo";
import { generateIdeas } from "../ai/writer";
import type { AppEnv } from "../lib/auth";

export async function createIdeasForToday(userId: string) {
  const settings = getSettings(userId);
  const profile = getProfile(userId);
  const recent = (
    db
      .prepare("SELECT content FROM posts WHERE user_id = ? AND status IN ('published','queued') ORDER BY updated_at DESC LIMIT 10")
      .all(userId) as any[]
  ).map((r) => r.content);
  const existing = (
    db.prepare("SELECT text FROM ideas WHERE user_id = ? AND status = 'new' ORDER BY created_at DESC LIMIT 30").all(userId) as any[]
  ).map((r) => r.text);
  const texts = await generateIdeas(settings, profile, recent, existing);
  const today = DateTime.now().setZone(settings.timezone).toISODate();
  const ins = db.prepare("INSERT INTO ideas (id, user_id, text, source, for_date) VALUES (?, ?, ?, 'ai', ?)");
  const ids = texts.map((t) => {
    const id = newId();
    ins.run(id, userId, t, today);
    return id;
  });
  return ids.map((id) => toIdea(db.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as any));
}

export const ideas = new Hono<AppEnv>();

ideas.get("/ideas", (c) => {
  const status = c.req.query("status");
  const rows = status
    ? db.prepare("SELECT * FROM ideas WHERE user_id = ? AND status = ? ORDER BY created_at DESC").all(c.get("userId"), status)
    : db.prepare("SELECT * FROM ideas WHERE user_id = ? ORDER BY created_at DESC").all(c.get("userId"));
  return c.json((rows as any[]).map(toIdea));
});

ideas.post("/ideas", async (c) => {
  const { text } = z.object({ text: z.string().min(1) }).parse(await c.req.json());
  const id = newId();
  db.prepare("INSERT INTO ideas (id, user_id, text, source) VALUES (?, ?, ?, 'me')").run(id, c.get("userId"), text.trim());
  return c.json(toIdea(db.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as any));
});

ideas.post("/ideas/generate", async (c) => c.json(await createIdeasForToday(c.get("userId"))));

ideas.patch("/ideas/:id", async (c) => {
  const body = z
    .object({ status: z.enum(["new", "used", "dismissed"]).optional(), text: z.string().min(1).optional() })
    .parse(await c.req.json());
  const uid = c.get("userId");
  const id = c.req.param("id");
  if (body.status) db.prepare("UPDATE ideas SET status = ? WHERE id = ? AND user_id = ?").run(body.status, id, uid);
  if (body.text) db.prepare("UPDATE ideas SET text = ? WHERE id = ? AND user_id = ?").run(body.text, id, uid);
  const row = db.prepare("SELECT * FROM ideas WHERE id = ? AND user_id = ?").get(id, uid);
  return row ? c.json(toIdea(row as any)) : c.json({ error: "Not found" }, 404);
});

ideas.delete("/ideas/:id", (c) => {
  db.prepare("DELETE FROM ideas WHERE id = ? AND user_id = ?").run(c.req.param("id"), c.get("userId"));
  return c.json({ ok: true });
});
