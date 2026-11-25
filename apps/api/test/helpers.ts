// Test setup: a real SQLite database (all migrations applied) in a temp folder, and a fetch
// stub for the external services only (LinkedIn, OpenRouter, push). Everything inside the app
// runs for real.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { db, setDb } from "../src/db";
import { setEnv } from "../src/runtime/env";
import { sqliteDb } from "../src/runtime/sqlite";
import { ensureUserDefaults } from "../src/repo";

export type Call = { url: string; method: string; headers: Record<string, string>; body: any };
export type Route = (call: Call) => Response | Promise<Response> | undefined;

export const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

/** An OpenAI-style chat completion whose message is `content`. */
export const aiReply = (content: unknown) =>
  json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });

export async function setup(extraEnv: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postdaily-test-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  setEnv({ RUNTIME: "node", OPENROUTER_API_KEY: "test", LINKEDIN_API_VERSION: "202606", ...extraEnv });
  setDb(sqliteDb(path.join(dir, "test.db")));

  const calls: Call[] = [];
  const routes: Route[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const rawHeaders = init.headers instanceof Headers ? Object.fromEntries(init.headers) : (init.headers ?? {});
    const headers = Object.fromEntries(Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), String(v)]));
    let body: any = init.body;
    try {
      body = typeof body === "string" ? JSON.parse(body) : body;
    } catch {}
    const call = { url, method: init.method ?? "GET", headers, body };
    calls.push(call);
    for (const r of [...routes].reverse()) {
      const res = await r(call);
      if (res) return res;
    }
    throw new Error(`Unexpected fetch in test: ${call.method} ${url}`);
  }) as typeof fetch;

  return {
    calls,
    /** Add a fake external endpoint. Later routes win. */
    route: (r: Route) => routes.push(r),
    find: (pred: (c: Call) => boolean) => calls.find(pred),
  };
}

/** A user with a valid LinkedIn connection and quiet defaults (no reminders/ideas). */
export async function createUser(id = "u1", opts: { timezone?: string } = {}) {
  await db.run(
    "INSERT INTO users (id, name, linkedin_sub, linkedin_token, linkedin_expires_at) VALUES (?, 'Test User', ?, 'TOKEN', ?)",
    id,
    `SUB_${id}`,
    new Date(Date.now() + 30 * 86_400_000).toISOString(),
  );
  await ensureUserDefaults(id);
  await db.run(
    "UPDATE settings SET ai_provider = 'openrouter', ai_model = 'test/model:free', reminder_enabled = 0, daily_ideas = 0, timezone = ? WHERE user_id = ?",
    opts.timezone ?? "UTC",
    id,
  );
  return id;
}

/** Fake LinkedIn: posts succeed (or return `postStatus`), uploads and comments work. */
export function fakeLinkedIn(t: Awaited<ReturnType<typeof setup>>, state: { postStatus: number; docStatus?: string } = { postStatus: 201 }) {
  t.route((c) => {
    if (c.url.includes("/rest/images?action=initializeUpload"))
      return json({ value: { uploadUrl: "https://upload.test/img", image: "urn:li:image:IMG1" } });
    if (c.url.includes("/rest/documents?action=initializeUpload"))
      return json({ value: { uploadUrl: "https://upload.test/doc", document: "urn:li:document:DOC1" } });
    if (c.url.startsWith("https://api.linkedin.com/rest/documents/"))
      return json({ id: "urn:li:document:DOC1", status: state.docStatus ?? "AVAILABLE" });
    if (c.url.startsWith("https://upload.test/")) return new Response(null, { status: 201 });
    if (c.url.endsWith("/rest/posts"))
      return state.postStatus === 201
        ? new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:111" } })
        : json({ message: "nope" }, state.postStatus);
    if (c.url.includes("/rest/socialActions/"))
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:comment:(urn:li:share:111,9)" } });
    return undefined;
  });
  return state;
}
