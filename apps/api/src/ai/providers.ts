// Switchable AI providers. Each one turns (system, prompt) into text.
// Providers here run anywhere (Node and Cloudflare). The "Claude login" provider needs a local
// Claude Code install, so the Node server registers it separately (runtime/claude-code.ts).
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AI_PROVIDER_LABELS, type AIProviderId, type ModelOption, type ProviderStatus } from "@postdaily/shared";
import { env } from "../runtime/env";
import { resolveKey } from "../lib/keystore";

export interface CompleteArgs {
  system: string;
  prompt: string;
  model: string;
  /** "low" for quick edits, "medium" for drafting. Only some providers use it. */
  effort?: "low" | "medium" | "high";
}

export class AIError extends Error {}

export type Provider = (args: CompleteArgs) => Promise<string>;
type StatusCheck = () => Promise<{ available: boolean; note: string }>;

/** SDK clients, one per API key (each user may have their own). */
function clientCache<C>(make: (key: string) => C) {
  const cache = new Map<string, C>();
  return (key: string) => {
    let c = cache.get(key);
    if (!c) {
      if (cache.size >= 50) cache.clear();
      c = make(key);
      cache.set(key, c);
    }
    return c;
  };
}

// --- Anthropic API key ---
const anthropicClient = clientCache((apiKey) => new Anthropic({ apiKey }));
const anthropic: Provider = async ({ system, prompt, model, effort = "medium" }) => {
  const key = (await resolveKey("anthropic"))?.key;
  if (!key) throw new AIError("Add an Anthropic API key in Settings to use the Anthropic provider.");
  try {
    const res = await anthropicClient(key).beta.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") throw new AIError("Claude declined this request. Try rephrasing your input.");
    return res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AIError("Anthropic API key is missing or invalid.");
    if (e instanceof Anthropic.RateLimitError) throw new AIError("Anthropic rate limit hit, try again shortly.");
    if (e instanceof Anthropic.APIError) throw new AIError(`Anthropic API error ${e.status}: ${e.message}`);
    throw e;
  }
};

// --- OpenAI ---
const openaiClient = clientCache((apiKey) => new OpenAI({ apiKey }));
const openai: Provider = async ({ system, prompt, model }) => {
  const key = (await resolveKey("openai"))?.key;
  if (!key) throw new AIError("Add an OpenAI API key in Settings to use the OpenAI provider.");
  const res = await openaiClient(key).chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
};

// --- OpenRouter (OpenAI-compatible; many free models with a ":free" suffix) ---
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
/**
 * Free models that were fast and wrote well in a 3-draft test (Nov 2026): ~9 s, ~21 s, ~39 s.
 * `openrouter/free` took ~111 s. Used as automatic fallbacks when a free model is busy.
 */
export const FAST_FREE_MODELS = [
  "particle-ai/particle-1:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];
const OPENROUTER_TIMEOUT_MS = 90_000;

/** Up to two fast free fallbacks that OpenRouter still lists, so a busy model doesn't stall you. */
async function freeFallbacks(model: string) {
  if (!model.endsWith(":free") && model !== "openrouter/free") return [];
  try {
    const free = new Set((await listOpenRouterModels()).filter((m) => m.free).map((m) => m.id));
    return FAST_FREE_MODELS.filter((id) => id !== model && free.has(id)).slice(0, 2);
  } catch {
    return [];
  }
}

const openrouterClient = clientCache(
  (apiKey) =>
    new OpenAI({
      apiKey,
      baseURL: OPENROUTER_URL,
      defaultHeaders: { "X-Title": "PostDaily" },
      timeout: OPENROUTER_TIMEOUT_MS,
      maxRetries: 0, // OpenRouter's own fallbacks handle busy models; retries would just double the wait
    }),
);
const openrouter: Provider = async ({ system, prompt, model }) => {
  const key = (await resolveKey("openrouter"))?.key;
  if (!key) throw new AIError("Add an OpenRouter API key in Settings (free key at openrouter.ai/keys).");
  const fallbacks = await freeFallbacks(model);
  try {
    const res = await openrouterClient(key).chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      // OpenRouter-specific options: try fallbacks if the model is busy, route to the fastest
      // host, and keep "thinking" short on reasoning models.
      ...({
        ...(fallbacks.length ? { models: [model, ...fallbacks] } : {}),
        provider: { sort: "throughput" },
        reasoning: { effort: "low", exclude: true },
      } as object),
    });
    const text = res.choices[0]?.message?.content ?? "";
    if (!text) throw new AIError("The model returned an empty response. Free models are sometimes overloaded; try again or pick another.");
    return text;
  } catch (e) {
    if (e instanceof OpenAI.APIConnectionTimeoutError)
      throw new AIError(
        `The model didn't answer within ${OPENROUTER_TIMEOUT_MS / 1000} seconds. Free models get busy; try again or pick a faster one in Settings.`,
      );
    if (e instanceof OpenAI.RateLimitError)
      throw new AIError("OpenRouter rate limit hit. Free models have daily limits; try later or pick another model.");
    if (e instanceof OpenAI.AuthenticationError) throw new AIError("OpenRouter API key is missing or invalid.");
    if (e instanceof OpenAI.APIError) throw new AIError(`OpenRouter error ${e.status}: ${e.message}`);
    throw e;
  }
};

let openrouterModels: { at: number; list: ModelOption[] } | null = null;
/** OpenRouter's text models, free ones first. Public endpoint, cached for an hour. */
export async function listOpenRouterModels(): Promise<ModelOption[]> {
  if (openrouterModels && Date.now() - openrouterModels.at < 3_600_000) return openrouterModels.list;
  const res = await fetch(`${OPENROUTER_URL}/models`);
  if (!res.ok) throw new AIError(`Couldn't load OpenRouter models (${res.status})`);
  const { data } = (await res.json()) as {
    data: {
      id: string;
      name: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      architecture?: { output_modalities?: string[] };
    }[];
  };
  const list = data
    // Text-only output (excludes e.g. music models that also return text).
    .filter((m) => {
      const out = m.architecture?.output_modalities;
      return !out || (out.length === 1 && out[0] === "text");
    })
    .map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length ?? null,
      free: Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0,
    }))
    .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
  openrouterModels = { at: Date.now(), list };
  return list;
}

// --- Ollama ---
const ollamaUrl = () => env("OLLAMA_URL");
const ollama: Provider = async ({ system, prompt, model }) => {
  const url = ollamaUrl();
  if (!url) throw new AIError("Set OLLAMA_URL to use Ollama.");
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new AIError(`Ollama error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
};

const providers: Partial<Record<AIProviderId, Provider>> = { anthropic, openrouter, openai, ollama };

async function keyStatus(provider: "anthropic" | "openrouter" | "openai", missing: string) {
  const k = await resolveKey(provider);
  if (!k) return { available: false, note: missing };
  return { available: true, note: k.source === "user" ? `Using your key (…${k.key.slice(-4)})` : "Using the server's key" };
}

const statusChecks: Record<AIProviderId, StatusCheck> = {
  "claude-code": async () => ({ available: false, note: "Only available when running PostDaily on your Mac" }),
  anthropic: () => keyStatus("anthropic", "Add an Anthropic API key below"),
  openrouter: () => keyStatus("openrouter", "Add an OpenRouter key below (free at openrouter.ai/keys)"),
  openai: () => keyStatus("openai", "Add an OpenAI API key below"),
  ollama: async () => {
    const url = ollamaUrl();
    if (!url) return { available: false, note: "Set OLLAMA_URL" };
    try {
      const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return { available: true, note: `Running at ${url}` };
    } catch {
      /* not running */
    }
    return { available: false, note: `Not reachable at ${url}` };
  },
};

/** Lets a runtime add a provider that only it supports (e.g. the local Claude login). */
export function registerProvider(id: AIProviderId, provider: Provider, status: StatusCheck) {
  providers[id] = provider;
  statusChecks[id] = status;
}

export function complete(provider: AIProviderId, args: CompleteArgs) {
  const fn = providers[provider];
  if (!fn) {
    throw new AIError(
      provider === "claude-code"
        ? "“Claude (my Claude login)” only works on the Mac version. Pick another AI provider in Settings."
        : `Unknown AI provider: ${provider}`,
    );
  }
  return fn(args);
}

export async function providerStatuses(): Promise<ProviderStatus[]> {
  return Promise.all(
    (Object.keys(statusChecks) as AIProviderId[]).map(async (id) => ({
      id,
      label: AI_PROVIDER_LABELS[id],
      ...(await statusChecks[id]()),
    })),
  );
}
