// The Hono app, shared by the Node server (node.ts) and the Cloudflare Worker (worker.ts).
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { requireAuth, type AppEnv } from "./lib/auth";
import { auth } from "./routes/auth";
import { main } from "./routes/main";
import { ideas } from "./routes/ideas";
import { posts } from "./routes/posts";
import { images } from "./routes/images";
import { AIError, AILimitError } from "./ai/providers";
import { env } from "./runtime/env";
import { db } from "./db";

export function createApp() {
  const app = new Hono<AppEnv>();

  // Only the web app's own origin may call the API from a browser (mobile apps don't use CORS).
  app.use(
    "/api/*",
    cors({
      origin: (origin, c) => {
        const allowed = env("WEB_URL") ?? new URL(c.req.url).origin;
        return origin === allowed ? origin : null;
      },
      allowHeaders: ["Content-Type", "Authorization", "X-Timezone"],
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => i.message).join("; ") }, 400);
    if (err instanceof AILimitError) return c.json({ error: err.message }, 429);
    if (err instanceof AIError) return c.json({ error: err.message }, 502);
    console.error(err);
    return c.json({ error: err.message || "Something went wrong" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api", auth);

  // Called by the service worker after a push ping. The (unguessable) push endpoint identifies
  // the device, so no session token is needed. Returns the newest unread notification.
  app.post("/api/push/pending", async (c) => {
    const { endpoint } = (await c.req.json().catch(() => ({}))) as { endpoint?: string };
    if (!endpoint) return c.json({ error: "endpoint required" }, 400);
    const sub = await db.get<{ user_id: string }>("SELECT user_id FROM push_subscriptions WHERE endpoint = ?", endpoint);
    if (!sub) return c.json({ error: "Unknown subscription" }, 404);
    const n = await db.get(
      "SELECT title, body FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT 1",
      sub.user_id,
    );
    return c.json(n ?? { title: "PostDaily", body: "Open PostDaily to see what's new." });
  });

  const protectedApi = new Hono<AppEnv>();
  protectedApi.use("*", requireAuth);
  protectedApi.route("/", main);
  protectedApi.route("/", ideas);
  protectedApi.route("/", posts);
  protectedApi.route("/", images);
  app.route("/api", protectedApi);

  return app;
}
