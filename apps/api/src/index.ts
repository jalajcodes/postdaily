import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ZodError } from "zod";
import fs from "node:fs";
import path from "node:path";
import "./db";
import { requireAuth, type AppEnv } from "./lib/auth";
import { auth } from "./routes/auth";
import { main } from "./routes/main";
import { ideas } from "./routes/ideas";
import { posts } from "./routes/posts";
import { AIError } from "./ai/providers";
import { startScheduler } from "./scheduler";

const app = new Hono<AppEnv>();
app.use("*", logger());
app.use("/api/*", cors({ origin: (o) => o ?? "*", allowHeaders: ["Content-Type", "Authorization", "X-Timezone"] }));

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

// In production, serve the built web app from the same server.
const webDist = path.resolve(import.meta.dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  const root = path.relative(process.cwd(), webDist);
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`PostDaily API on http://localhost:${port}`);
  startScheduler();
});
