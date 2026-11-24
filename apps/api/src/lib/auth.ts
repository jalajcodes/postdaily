import { createMiddleware } from "hono/factory";
import { db } from "../db";

export type AppEnv = { Variables: { userId: string } };

/** Sessions last 30 days; the token is only ever stored as a SHA-256 hash. */
export const SESSION_DAYS = 30;

export function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(userId: string) {
  const token = randomToken();
  await db.run("INSERT INTO sessions (token, user_id) VALUES (?, ?)", await hashToken(token), userId);
  return token;
}

export async function userIdForToken(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const since = new Date(Date.now() - SESSION_DAYS * 86_400_000).toISOString();
  const row = await db.get<{ user_id: string }>(
    "SELECT user_id FROM sessions WHERE token = ? AND created_at > ?",
    await hashToken(token),
    since,
  );
  return row?.user_id ?? null;
}

export const bearer = (header: string | undefined) => (header?.startsWith("Bearer ") ? header.slice(7) : null);

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const userId = await userIdForToken(bearer(c.req.header("Authorization")));
  if (!userId) return c.json({ error: "Not signed in" }, 401);
  c.set("userId", userId);
  await next();
});
