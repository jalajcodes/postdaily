// The Hono app, shared by the Node server (node.ts) and the Cloudflare Worker (worker.ts).
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { requireAuth, type AppEnv } from "./lib/auth";
import { auth } from "./routes/auth";
import { main } from "./routes/main";
import { ideas } from "./routes/ideas";
import { posts } from "./routes/posts";
import { AIError } from "./ai/providers";
import { env } from "./runtime/env";

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
    if (err instanceof AIError) return c.json({ error: err.message }, 502);
    console.error(err);
    return c.json({ error: err.message || "Something went wrong" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api", auth);

  const protectedApi = new Hono<AppEnv>();
  protectedApi.use("*", requireAuth);
  protectedApi.route("/", main);
  protectedApi.route("/", ideas);
  protectedApi.route("/", posts);
  app.route("/api", protectedApi);

  return app;
}
