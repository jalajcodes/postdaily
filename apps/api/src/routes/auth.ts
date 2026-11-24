import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { db, newId } from "../db";
import { ensureUserDefaults, getUserRow, toUser, updateSettings } from "../repo";
import { createSession, requireAuth, type AppEnv } from "../lib/auth";
import { authorizeUrl, exchangeCode, fetchUserInfo, linkedinEnabled } from "../lib/linkedin";

const webUrl = () => process.env.WEB_URL ?? "http://localhost:5173";
const devLoginEnabled = () => process.env.ALLOW_DEV_LOGIN !== "false" && process.env.NODE_ENV !== "production";

// OAuth state -> where to send the user afterwards (web URL or a mobile deep link)
const pendingStates = new Map<string, { redirect: string; expires: number; userId?: string }>();

/** Only allow redirects back to our web app or an app deep link (postdaily://). */
function safeRedirect(r: string | undefined) {
  if (!r) return `${webUrl()}/auth/callback`;
  if (r.startsWith(webUrl()) || r.startsWith("postdaily://")) return r;
  return `${webUrl()}/auth/callback`;
}

export const auth = new Hono<AppEnv>();

auth.get("/auth/config", (c) => c.json({ linkedinEnabled: linkedinEnabled(), devLoginEnabled: devLoginEnabled() }));

auth.get("/auth/linkedin/start", (c) => {
  if (!linkedinEnabled()) return c.json({ error: "LinkedIn is not configured. Set LINKEDIN_CLIENT_ID/SECRET." }, 400);
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, { redirect: safeRedirect(c.req.query("redirect")), expires: Date.now() + 10 * 60_000 });
  return c.redirect(authorizeUrl(state));
});

// Signed-in user connecting/reconnecting LinkedIn: link it to the current account.
auth.post("/auth/linkedin/link", requireAuth, (c) => {
  if (!linkedinEnabled()) return c.json({ error: "LinkedIn is not configured. Set LINKEDIN_CLIENT_ID/SECRET." }, 400);
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, {
    redirect: safeRedirect(c.req.query("redirect")),
    expires: Date.now() + 10 * 60_000,
    userId: c.get("userId"),
  });
  return c.json({ url: authorizeUrl(state) });
});

auth.get("/auth/linkedin/callback", async (c) => {
  const { code, state, error, error_description } = c.req.query();
  const pending = state ? pendingStates.get(state) : undefined;
  if (state) pendingStates.delete(state);
  const back = pending?.redirect ?? `${webUrl()}/auth/callback`;
  if (error || !code || !pending || pending.expires < Date.now()) {
    return c.redirect(`${back}#error=${encodeURIComponent(error_description ?? error ?? "Sign-in expired, try again")}`);
  }
  try {
    const { accessToken, expiresIn } = await exchangeCode(code);
    const info = await fetchUserInfo(accessToken);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    let user = db.prepare("SELECT * FROM users WHERE linkedin_sub = ?").get(info.sub) as any;
    const targetId = user?.id ?? pending.userId;
    if (targetId) {
      db.prepare(
        "UPDATE users SET name=?, email=?, picture=?, linkedin_sub=?, linkedin_token=?, linkedin_expires_at=? WHERE id=?",
      ).run(info.name, info.email ?? null, info.picture ?? null, info.sub, accessToken, expiresAt, targetId);
      user = getUserRow(targetId);
    } else {
      const id = newId();
      db.prepare(
        "INSERT INTO users (id, name, email, picture, linkedin_sub, linkedin_token, linkedin_expires_at) VALUES (?,?,?,?,?,?,?)",
      ).run(id, info.name, info.email ?? null, info.picture ?? null, info.sub, accessToken, expiresAt);
      ensureUserDefaults(id);
      user = getUserRow(id);
    }
    const token = createSession(user.id);
    return c.redirect(`${back}#token=${token}`);
  } catch (e) {
    console.error(e);
    return c.redirect(`${back}#error=${encodeURIComponent((e as Error).message)}`);
  }
});

auth.post("/auth/dev-login", (c) => {
  if (!devLoginEnabled()) return c.json({ error: "Local login is disabled" }, 403);
  let user = db.prepare("SELECT * FROM users ORDER BY created_at LIMIT 1").get() as any;
  if (!user) {
    const id = newId();
    db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(id, "Me");
    ensureUserDefaults(id);
    user = getUserRow(id);
  }
  return c.json({ token: createSession(user.id) });
});

auth.get("/me", requireAuth, (c) => {
  const row = getUserRow(c.get("userId"));
  if (!row) return c.json({ error: "Not signed in" }, 401);
  ensureUserDefaults(row.id);
  // First request from a browser: default the timezone if still UTC.
  const tz = c.req.header("X-Timezone");
  if (tz) {
    const s = db.prepare("SELECT timezone FROM settings WHERE user_id = ?").get(row.id) as any;
    if (s?.timezone === "UTC" && tz !== "UTC") updateSettings(row.id, { timezone: tz });
  }
  return c.json(toUser(row));
});

auth.post("/auth/logout", requireAuth, (c) => {
  const token = c.req.header("Authorization")!.slice(7);
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  return c.json({ ok: true });
});
