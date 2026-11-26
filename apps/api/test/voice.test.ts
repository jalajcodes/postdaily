// Voice notes: recorded audio -> text, via Workers AI (Cloudflare) or OpenAI (Mac server).
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createApp } from "../src/app";
import { createSession } from "../src/lib/auth";
import { setEnv } from "../src/runtime/env";
import { resetTranscribeState, setAiBinding, WHISPER_FALLBACK, WHISPER_MODEL } from "../src/ai/transcribe";
import { createUser, json, setup } from "./helpers";

let t: Awaited<ReturnType<typeof setup>>;
let token: string;
const app = createApp();
const audio = Buffer.concat([Buffer.from("OggS fake opus header"), Buffer.alloc(4000, 7)]);

async function send(body: Uint8Array, type = "audio/webm;codecs=opus") {
  const res = await app.request("http://test.local/api/ai/transcribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": type },
    body: body as unknown as BodyInit,
  });
  return { status: res.status, body: (await res.json()) as any };
}

before(async () => {
  t = await setup();
  await createUser("u1");
  token = await createSession("u1");
});

test("Cloudflare: sends base64 audio to Whisper with VAD and returns trimmed text", async () => {
  resetTranscribeState();
  const calls: { model: string; input: any }[] = [];
  setAiBinding({ run: async (model: string, input: any) => (calls.push({ model, input }), { text: "  so we shipped it in two days  " }) });
  const r = await send(audio);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.text, "so we shipped it in two days");
  assert.equal(calls[0].model, WHISPER_MODEL);
  assert.equal(calls[0].input.vad_filter, true);
  assert.deepEqual(Buffer.from(calls[0].input.audio, "base64"), audio, "audio arrives byte for byte");
  const status = await app.request("http://test.local/api/ai/transcribe", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(((await status.json()) as { available: boolean }).available, true);
});

test("rejects non-audio, empty and oversized uploads, and silence", async () => {
  resetTranscribeState();
  setAiBinding({ run: async () => ({ text: "" }) });
  assert.equal((await send(audio, "application/json")).status, 415);
  assert.equal((await send(new Uint8Array(10))).status, 400);
  assert.equal((await send(new Uint8Array(10 * 1024 * 1024 + 1))).status, 413);
  const silent = await send(audio);
  assert.equal(silent.status, 422);
  assert.match(silent.body.error, /Didn't catch any words/);
});

test("when Whisper Turbo fails, falls back to the original Whisper (bytes as an array)", async () => {
  const calls: { model: string; input: any }[] = [];
  setAiBinding({
    run: async (model: string, input: any) => {
      calls.push({ model, input });
      if (model === WHISPER_MODEL) throw new Error("3043: Transcription failed: Library libcublas.so.12 is not found");
      return { text: "fallback words " };
    },
  });
  const r = await send(audio);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.text, "fallback words");
  assert.deepEqual(calls.map((c) => c.model), [WHISPER_MODEL, WHISPER_FALLBACK]);
  assert.ok(Array.isArray(calls[1].input.audio));
  assert.deepEqual(Buffer.from(calls[1].input.audio), audio, "same bytes reach the fallback");

  // Turbo is skipped for a while after failing.
  calls.length = 0;
  await send(audio);
  assert.deepEqual(calls.map((c) => c.model), [WHISPER_FALLBACK]);
  resetTranscribeState();
});

test("the fallback is retried once", async () => {
  resetTranscribeState();
  let n = 0;
  setAiBinding({
    run: async (model: string) => {
      if (model === WHISPER_MODEL) throw new Error("3043");
      if (++n === 1) throw new Error("3046: Request timeout");
      return { text: "second try" };
    },
  });
  const r = await send(audio);
  assert.equal(r.status, 200);
  assert.equal(r.body.text, "second try");
  assert.equal(n, 2);
});

test("when both models fail, a readable error comes back", async () => {
  resetTranscribeState();
  setAiBinding({ run: async () => { throw new Error("3010: Invalid or incomplete input"); } });
  const r = await send(audio);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Transcription failed: 3010.*try again in a minute/);
});

test("Mac server: uses OpenAI when a key is set, otherwise explains what's needed", async () => {
  setAiBinding(undefined);
  setEnv({ RUNTIME: "node" });
  const none = await send(audio);
  assert.equal(none.status, 502);
  assert.match(none.body.error, /Cloudflare deployment .* or an OpenAI API key/);

  setEnv({ RUNTIME: "node", OPENAI_API_KEY: "sk-test" });
  t.route((c) => (c.url.endsWith("/audio/transcriptions") ? json({ text: "hello from openai" }) : undefined));
  t.calls.length = 0;
  const r = await send(audio, "audio/mp4");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.text, "hello from openai");
  const call = t.find((c) => c.url.endsWith("/audio/transcriptions"))!;
  const form = call.body as FormData;
  assert.equal(form.get("model"), "whisper-1");
  const file = form.get("file") as File;
  assert.equal(file.name, "voice-note.m4a");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio);
});
