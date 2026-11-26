// Checks an API key with its provider before it's saved, so a typo shows up right away
// instead of as a failed draft later.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { KeyProvider } from "@postdaily/shared";

export const KEY_FORMAT: Record<KeyProvider, { prefix: string; label: string }> = {
  openrouter: { prefix: "sk-or-", label: "OpenRouter" },
  anthropic: { prefix: "sk-ant-", label: "Anthropic" },
  openai: { prefix: "sk-", label: "OpenAI" },
};

export class InvalidKeyError extends Error {}
/** The provider couldn't be reached, so we don't know if the key works. */
export class VerifyUnavailableError extends Error {}

/** Basic shape check, done before contacting the provider. Returns an error message or null. */
export function checkKeyFormat(provider: KeyProvider, key: string): string | null {
  const { prefix, label } = KEY_FORMAT[provider];
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) return `That doesn't look like a ${label} API key.`;
  if (!key.startsWith(prefix)) return `${label} keys start with "${prefix}".`;
  if (provider === "openai" && (key.startsWith("sk-or-") || key.startsWith("sk-ant-"))) return "That's not an OpenAI key.";
  return null;
}

const TIMEOUT_MS = 15_000;

export async function verifyKey(provider: KeyProvider, key: string): Promise<void> {
  const { label } = KEY_FORMAT[provider];
  const invalid = () => new InvalidKeyError(`${label} didn't accept this key. Check that you copied all of it and that it's active.`);
  const unreachable = () => new VerifyUnavailableError(`Couldn't reach ${label} to check the key. Try again in a moment.`);

  if (provider === "openrouter") {
    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw unreachable();
    }
    if (res.status === 401 || res.status === 403) throw invalid();
    if (!res.ok) throw unreachable();
    return;
  }

  if (provider === "anthropic") {
    try {
      await new Anthropic({ apiKey: key, maxRetries: 0, timeout: TIMEOUT_MS }).models.list({ limit: 1 });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw invalid();
      throw unreachable();
    }
    return;
  }

  try {
    await new OpenAI({ apiKey: key, maxRetries: 0, timeout: TIMEOUT_MS }).models.list();
  } catch (e) {
    if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) throw invalid();
    throw unreachable();
  }
}
