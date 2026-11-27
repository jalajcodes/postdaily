// Your image library: every AI image you make is kept here (up to MAX_LIBRARY_IMAGES) so you
// can attach it to a post later, download it, or delete it.
import { Hono } from "hono";
import { MAX_LIBRARY_IMAGES, type ImageModel, type ImageStyle, type LibraryImage } from "@postdaily/shared";
import { db, newId } from "../db";
import type { AppEnv } from "../lib/auth";

type Row = { id: string; prompt: string; style: ImageStyle; model: ImageModel; bytes: number; created_at: string };
const toImage = (r: Row): LibraryImage => ({ id: r.id, prompt: r.prompt, style: r.style, model: r.model, bytes: r.bytes, createdAt: r.created_at });

export class LibraryFullError extends Error {
  constructor() {
    super(`Your image library is full (${MAX_LIBRARY_IMAGES} images). Delete some in Images first.`);
  }
}

export async function libraryCount(userId: string) {
  return (await db.get<{ n: number }>("SELECT count(*) AS n FROM images WHERE user_id = ?", userId))?.n ?? 0;
}

export async function saveToLibrary(
  userId: string,
  img: { dataUrl: string; prompt: string; style: ImageStyle; model: ImageModel },
): Promise<LibraryImage> {
  if ((await libraryCount(userId)) >= MAX_LIBRARY_IMAGES) throw new LibraryFullError();
  const id = newId();
  const bytes = Math.floor(((img.dataUrl.length - img.dataUrl.indexOf(",") - 1) * 3) / 4);
  await db.run(
    "INSERT INTO images (id, user_id, data_url, prompt, style, model, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    userId,
    img.dataUrl,
    img.prompt,
    img.style,
    img.model,
    bytes,
  );
  return toImage((await db.get<Row>("SELECT id, prompt, style, model, bytes, created_at FROM images WHERE id = ?", id))!);
}

export const images = new Hono<AppEnv>();

images.get("/images", async (c) => {
  const rows = await db.all<Row>(
    "SELECT id, prompt, style, model, bytes, created_at FROM images WHERE user_id = ? ORDER BY created_at DESC",
    c.get("userId"),
  );
  return c.json(rows.map(toImage));
});

images.get("/images/:id", async (c) => {
  const row = await db.get<{ data_url: string }>("SELECT data_url FROM images WHERE id = ? AND user_id = ?", c.req.param("id"), c.get("userId"));
  return row ? c.json({ dataUrl: row.data_url }) : c.json({ error: "Image not found" }, 404);
});

images.delete("/images/:id", async (c) => {
  await db.run("DELETE FROM images WHERE id = ? AND user_id = ?", c.req.param("id"), c.get("userId"));
  return c.json({ ok: true });
});
