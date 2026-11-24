// Switchable AI providers. Each one turns (system, prompt) into text.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AI_PROVIDER_LABELS, type AIProviderId, type ProviderStatus } from "@postdaily/shared";

export interface CompleteArgs {
  system: string;
  prompt: string;
  model: string;
  /** "low" for quick edits, "medium" for drafting. Only some providers use it. */
  effort?: "low" | "medium" | "high";
}

export class AIError extends Error {}

type Provider = (args: CompleteArgs) => Promise<string>;

// --- Claude via your local Claude Code login (Claude Agent SDK) ---
const claudeCode: Provider = async ({ system, prompt, model }) => {
  // Drop API-key env vars so the SDK uses your Claude login rather than a key.
  const { ANTHROPIC_API_KEY: _k, ANTHROPIC_AUTH_TOKEN: _t, ...env } = process.env;
  let text = "";
  for await (const msg of query({
    prompt,
    options: {
      systemPrompt: system,
      model,
      maxTurns: 1,
      tools: [],
      settingSources: [],
      persistSession: false,
      env,
    },
  })) {
    if (msg.type === "result") {
      if (msg.subtype === "success") text = msg.result;
      else throw new AIError(`Claude login provider failed (${msg.subtype}). Run \`claude\` and sign in, then retry.`);
    }
  }
  if (!text) throw new AIError("Claude returned an empty response.");
  return text;
};

// --- Anthropic API key ---
let anthropicClient: Anthropic | null = null;
const anthropic: Provider = async ({ system, prompt, model, effort = "medium" }) => {
  anthropicClient ??= new Anthropic();
  try {
    const res = await anthropicClient.beta.messages.create({
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
let openaiClient: OpenAI | null = null;
const openai: Provider = async ({ system, prompt, model }) => {
  openaiClient ??= new OpenAI();
  const res = await openaiClient.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
};

// --- Ollama ---
const ollamaUrl = () => process.env.OLLAMA_URL || "http://localhost:11434";
const ollama: Provider = async ({ system, prompt, model }) => {
  const res = await fetch(`${ollamaUrl()}/api/chat`, {
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

const providers: Record<AIProviderId, Provider> = {
  "claude-code": claudeCode,
  anthropic,
  openai,
  ollama,
};

export function complete(provider: AIProviderId, args: CompleteArgs) {
  const fn = providers[provider];
  if (!fn) throw new AIError(`Unknown AI provider: ${provider}`);
  return fn(args);
}

export async function providerStatuses(): Promise<ProviderStatus[]> {
  const claudeLoggedIn =
    fs.existsSync(path.join(os.homedir(), ".claude.json")) || fs.existsSync(path.join(os.homedir(), ".claude"));
  let ollamaUp = false;
  try {
    const r = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(800) });
    ollamaUp = r.ok;
  } catch {
    /* not running */
  }
  const s = (id: AIProviderId, available: boolean, note: string): ProviderStatus => ({
    id,
    label: AI_PROVIDER_LABELS[id],
    available,
    note,
  });
  return [
    s(
      "claude-code",
      claudeLoggedIn,
      claudeLoggedIn ? "Uses your local Claude Code sign-in" : "Run `claude` in a terminal and sign in first",
    ),
    s("anthropic", Boolean(process.env.ANTHROPIC_API_KEY), process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY set" : "Set ANTHROPIC_API_KEY in .env"),
    s("openai", Boolean(process.env.OPENAI_API_KEY), process.env.OPENAI_API_KEY ? "OPENAI_API_KEY set" : "Set OPENAI_API_KEY in .env"),
    s("ollama", ollamaUp, ollamaUp ? `Running at ${ollamaUrl()}` : `Not reachable at ${ollamaUrl()}`),
  ];
}
