import { createMiddleware } from "hono/factory";
import { randomBytes } from "node:crypto";
import { db } from "../db";

export type AppEnv = { Variables: { userId: string } };

export function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, userId);
  return token;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const row = token
    ? (db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token) as { user_id: string } | undefined)
    : undefined;
  if (!row) return c.json({ error: "Not signed in" }, 401);
  c.set("userId", row.user_id);
  await next();
});
