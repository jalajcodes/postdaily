// Cloudflare Worker entry: D1 database, Cron Trigger scheduler, web app served as static assets.
import type { D1Database, ExecutionContext, ScheduledController } from "@cloudflare/workers-types";
import { setDb } from "./db";
import { setEnv } from "./runtime/env";
import { d1Db } from "./runtime/d1";
import { runScheduledTick } from "./scheduler";
import { createApp } from "./app";
import { setAiBinding } from "./ai/transcribe";

interface Env {
  DB: D1Database;
  [key: string]: unknown;
}

const app = createApp();

function init(env: Env) {
  setEnv({ ...env, RUNTIME: "worker" });
  setDb(d1Db(env.DB));
  setAiBinding(env.AI);
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    init(env);
    return app.fetch(request, env, ctx as any);
  },
  // Runs every minute (see "triggers" in wrangler.jsonc).
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    init(env);
    ctx.waitUntil(runScheduledTick());
  },
};
