// Local server for your Mac: SQLite file, Claude-login AI provider, macOS notifications,
// and a once-a-minute timer for the scheduler.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "hono/logger";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setDb } from "./db";
import { setEnv } from "./runtime/env";
import { sqliteDb } from "./runtime/sqlite";
import { registerClaudeCodeProvider } from "./runtime/claude-code";
import { runScheduledTick, setDesktopNotifier } from "./scheduler";
import { createApp } from "./app";

setEnv({ ...process.env, RUNTIME: "node" });
setDb(sqliteDb(path.resolve(process.env.DATABASE_PATH ?? "./data/postdaily.db")));
registerClaudeCodeProvider();

if (process.platform === "darwin" && process.env.MAC_NOTIFICATIONS !== "false") {
  setDesktopNotifier((title, body) => {
    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => {});
  });
}

const app = createApp();
app.use("*", logger());

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
  runScheduledTick();
  setInterval(runScheduledTick, 60_000);
});
