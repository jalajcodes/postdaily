import { Hono, type Context } from "hono";
import { db, newId } from "../db";
import { env, runtime } from "../runtime/env";
import { ensureUserDefaults, getUserRow, toUser, updateSettings } from "../repo";
import { bearer, createSession, hashToken, randomToken, requireAuth, type AppEnv } from "../lib/auth";
import { authorizeUrl, exchangeCode, fetchUserInfo, linkedinEnabled } from "../lib/linkedin";

/** Where the web app lives. Defaults to the URL this request came in on (same-origin deploys). */
const webUrl = (c: Context) => env("WEB_URL") ?? new URL(c.req.url).origin;
/** Public URL of this API, used for the LinkedIn redirect URI. */
const apiUrl = (c: Context) => env("API_URL") ?? new URL(c.req.url).origin;

/** Local "Continue without LinkedIn" login. Only when explicitly enabled (never on Cloudflare). */
const devLoginEnabled = () => env("ALLOW_DEV_LOGIN") === "true" && runtime() === "node";

/**
 * Who may create an account. With ALLOWED_EMAILS set (comma-separated), only those LinkedIn
 * emails. Otherwise, on Cloudflare only the first person to sign in becomes the owner.
 */
async function canCreateUser(email: string | undefined) {
  const allow = env("ALLOWED_EMAILS")
    ?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allow?.length) return !!email && allow.includes(email.toLowerCase());
  if (runtime() === "node") return true;
  return !(await db.get("SELECT 1 FROM users LIMIT 1"));
}

/** Only allow redirects back to our web app or an app deep link (postdaily://). */
function safeRedirect(c: Context, r: string | undefined) {
  const fallback = `${webUrl(c)}/auth/callback`;
  if (!r) return fallback;
  if (r.startsWith(`${webUrl(c)}/`) || r.startsWith("postdaily://")) return r;
  return fallback;
}

async function newState(c: Context, userId?: string) {
  const state = randomToken(16);
  // Clean up expired states while we're here.
  await db.run("DELETE FROM oauth_states WHERE expires_at < ?", new Date().toISOString());
  await db.run(
    "INSERT INTO oauth_states (state, redirect, user_id, expires_at) VALUES (?, ?, ?, ?)",
    state,
    safeRedirect(c, c.req.query("redirect")),
    userId ?? null,
    new Date(Date.now() + 10 * 60_000).toISOString(),
  );
  return state;
}

export const auth = new Hono<AppEnv>();

auth.get("/auth/config", (c) => c.json({ linkedinEnabled: linkedinEnabled(), devLoginEnabled: devLoginEnabled() }));

auth.get("/auth/linkedin/start", async (c) => {
  if (!linkedinEnabled()) return c.json({ error: "LinkedIn is not configured. Set LINKEDIN_CLIENT_ID/SECRET." }, 400);
  return c.redirect(authorizeUrl(apiUrl(c), await newState(c)));
});

// Signed-in user connecting/reconnecting LinkedIn: link it to the current account.
auth.post("/auth/linkedin/link", requireAuth, async (c) => {
  if (!linkedinEnabled()) return c.json({ error: "LinkedIn is not configured. Set LINKEDIN_CLIENT_ID/SECRET." }, 400);
  return c.json({ url: authorizeUrl(apiUrl(c), await newState(c, c.get("userId"))) });
});

auth.get("/auth/linkedin/callback", async (c) => {
  const { code, state, error, error_description } = c.req.query();
  const pending = state ? await db.get("SELECT * FROM oauth_states WHERE state = ?", state) : undefined;
  if (state) await db.run("DELETE FROM oauth_states WHERE state = ?", state);
  const back = pending?.redirect ?? `${webUrl(c)}/auth/callback`;
  if (error || !code || !pending || pending.expires_at < new Date().toISOString()) {
    return c.redirect(`${back}#error=${encodeURIComponent(error_description ?? error ?? "Sign-in expired, try again")}`);
  }
  try {
    const { accessToken, expiresIn } = await exchangeCode(apiUrl(c), code);
    const info = await fetchUserInfo(accessToken);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const existing = await db.get("SELECT id FROM users WHERE linkedin_sub = ?", info.sub);
    let userId: string | undefined = existing?.id ?? pending.user_id ?? undefined;
    if (userId) {
      await db.run(
        "UPDATE users SET name=?, email=?, picture=?, linkedin_sub=?, linkedin_token=?, linkedin_expires_at=? WHERE id=?",
        info.name,
        info.email ?? null,
        info.picture ?? null,
        info.sub,
        accessToken,
        expiresAt,
        userId,
      );
    } else {
      if (!(await canCreateUser(info.email))) {
        return c.redirect(`${back}#error=${encodeURIComponent("This PostDaily is private. Ask the owner to add your email to ALLOWED_EMAILS.")}`);
      }
      userId = newId();
      await db.run(
        "INSERT INTO users (id, name, email, picture, linkedin_sub, linkedin_token, linkedin_expires_at) VALUES (?,?,?,?,?,?,?)",
        userId,
        info.name,
        info.email ?? null,
        info.picture ?? null,
        info.sub,
        accessToken,
        expiresAt,
      );
      await ensureUserDefaults(userId);
    }
    const token = await createSession(userId);
    return c.redirect(`${back}#token=${token}`);
  } catch (e) {
    console.error(e);
    return c.redirect(`${back}#error=${encodeURIComponent((e as Error).message)}`);
  }
});

auth.post("/auth/dev-login", async (c) => {
  if (!devLoginEnabled()) return c.json({ error: "Local login is disabled" }, 403);
  let user = await db.get("SELECT id FROM users ORDER BY created_at LIMIT 1");
  if (!user) {
    const id = newId();
    await db.run("INSERT INTO users (id, name) VALUES (?, ?)", id, "Me");
    await ensureUserDefaults(id);
    user = { id };
  }
  return c.json({ token: await createSession(user.id) });
});

auth.get("/me", requireAuth, async (c) => {
  const row = await getUserRow(c.get("userId"));
  if (!row) return c.json({ error: "Not signed in" }, 401);
  await ensureUserDefaults(row.id);
  // First request from a browser: default the timezone if still UTC.
  const tz = c.req.header("X-Timezone");
  if (tz) {
    const s = await db.get("SELECT timezone FROM settings WHERE user_id = ?", row.id);
    if (s?.timezone === "UTC" && tz !== "UTC") await updateSettings(row.id, { timezone: tz });
  }
  return c.json(toUser(row));
});

auth.post("/auth/logout", requireAuth, async (c) => {
  await db.run("DELETE FROM sessions WHERE token = ?", await hashToken(bearer(c.req.header("Authorization"))!));
  return c.json({ ok: true });
});
