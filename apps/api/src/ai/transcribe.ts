// Speech-to-text for voice notes in browsers without working live dictation (Brave, Arc,
// Firefox, some in-app browsers). On Cloudflare it uses Workers AI's Whisper (free daily
// allowance: about 200 audio minutes); on the Mac server it uses OpenAI if OPENAI_API_KEY is set.
import OpenAI from "openai";
import { env } from "../runtime/env";
import { AIError } from "./providers";

export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<unknown> };
let workersAi: AiBinding | null = null;

/** The Worker passes its `AI` binding here. */
export function setAiBinding(ai: unknown) {
  workersAi = ai && typeof (ai as AiBinding).run === "function" ? (ai as AiBinding) : null;
}

export const transcriptionAvailable = () => Boolean(workersAi || env("OPENAI_API_KEY"));

function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const EXT: Record<string, string> = { webm: "webm", ogg: "ogg", mp4: "m4a", m4a: "m4a", mpeg: "mp3", mp3: "mp3", wav: "wav", "x-wav": "wav", aac: "aac" };

export async function transcribe(audio: Uint8Array, contentType: string): Promise<string> {
  if (workersAi) {
    try {
      const out = (await workersAi.run(WHISPER_MODEL, { audio: toBase64(audio), vad_filter: true })) as { text?: string };
      return (out?.text ?? "").trim();
    } catch (e) {
      throw new AIError(`Transcription failed: ${(e as Error).message}`);
    }
  }
  const key = env("OPENAI_API_KEY");
  if (key) {
    const sub = contentType.split(";")[0].split("/")[1] ?? "webm";
    const client = new OpenAI({ apiKey: key, maxRetries: 1, timeout: 60_000 });
    try {
      const res = await client.audio.transcriptions.create({
        model: "whisper-1",
        file: new File([audio as Uint8Array<ArrayBuffer>], `voice-note.${EXT[sub] ?? "webm"}`, { type: contentType.split(";")[0] }),
      });
      return res.text.trim();
    } catch (e) {
      throw new AIError(`Transcription failed: ${(e as Error).message}`);
    }
  }
  throw new AIError("Voice notes need the Cloudflare deployment (free speech-to-text) or OPENAI_API_KEY on this server.");
}
