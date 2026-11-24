import { Hono } from "hono";
import { DateTime } from "luxon";
import { z } from "zod";
import { db, newId } from "../db";
import { getProfile, getSettings, toIdea } from "../repo";
import { generateIdeas } from "../ai/writer";
import type { AppEnv } from "../lib/auth";

export async function createIdeasForToday(userId: string) {
  const settings = await getSettings(userId);
  const profile = await getProfile(userId);
  const recent = (
    await db.all(
      "SELECT content FROM posts WHERE user_id = ? AND status IN ('published','queued') ORDER BY updated_at DESC LIMIT 10",
      userId,
    )
  ).map((r) => r.content);
  const existing = (
    await db.all("SELECT text FROM ideas WHERE user_id = ? AND status = 'new' ORDER BY created_at DESC LIMIT 30", userId)
  ).map((r) => r.text);
  const texts = await generateIdeas(settings, profile, recent, existing);
  const today = DateTime.now().setZone(settings.timezone).toISODate();
  const ids = texts.map(() => newId());
  await db.batch(
    texts.map((t, i) => ({
      sql: "INSERT INTO ideas (id, user_id, text, source, for_date) VALUES (?, ?, ?, 'ai', ?)",
      params: [ids[i], userId, t, today],
    })),
  );
  const rows = await db.all(`SELECT * FROM ideas WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  return ids.map((id) => toIdea(rows.find((r) => r.id === id)!));
}

export const ideas = new Hono<AppEnv>();

ideas.get("/ideas", async (c) => {
  const status = c.req.query("status");
  const rows = status
    ? await db.all("SELECT * FROM ideas WHERE user_id = ? AND status = ? ORDER BY created_at DESC", c.get("userId"), status)
    : await db.all("SELECT * FROM ideas WHERE user_id = ? ORDER BY created_at DESC", c.get("userId"));
  return c.json(rows.map(toIdea));
});

ideas.post("/ideas", async (c) => {
  const { text } = z.object({ text: z.string().min(1) }).parse(await c.req.json());
  const id = newId();
  await db.run("INSERT INTO ideas (id, user_id, text, source) VALUES (?, ?, ?, 'me')", id, c.get("userId"), text.trim());
  return c.json(toIdea((await db.get("SELECT * FROM ideas WHERE id = ?", id))!));
});

ideas.post("/ideas/generate", async (c) => c.json(await createIdeasForToday(c.get("userId"))));

ideas.patch("/ideas/:id", async (c) => {
  const body = z
    .object({ status: z.enum(["new", "used", "dismissed"]).optional(), text: z.string().min(1).optional() })
    .parse(await c.req.json());
  const uid = c.get("userId");
  const id = c.req.param("id");
  if (body.status) await db.run("UPDATE ideas SET status = ? WHERE id = ? AND user_id = ?", body.status, id, uid);
  if (body.text) await db.run("UPDATE ideas SET text = ? WHERE id = ? AND user_id = ?", body.text, id, uid);
  const row = await db.get("SELECT * FROM ideas WHERE id = ? AND user_id = ?", id, uid);
  return row ? c.json(toIdea(row)) : c.json({ error: "Not found" }, 404);
});

ideas.delete("/ideas/:id", async (c) => {
  await db.run("DELETE FROM ideas WHERE id = ? AND user_id = ?", c.req.param("id"), c.get("userId"));
  return c.json({ ok: true });
});
