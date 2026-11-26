// API keys added from the web app. Write-only: once saved, a key is never sent back to the
// browser, only its last 4 characters. Stored encrypted (AES-256-GCM) with a key derived from
// the KEYS_SECRET server secret, so a database leak alone doesn't reveal them.
import { KEY_PROVIDERS, type KeyProvider, type StoredKey } from "@postdaily/shared";
import { db } from "../db";
import { env } from "../runtime/env";
import { currentUserId } from "./user-context";

export const ENV_KEY: Record<KeyProvider, string> = {
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export class KeystoreError extends Error {}

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const canStoreKeys = () => (env("KEYS_SECRET")?.length ?? 0) >= 16;

let derived: { secret: string; key: CryptoKey } | null = null;
async function cryptoKey() {
  const secret = env("KEYS_SECRET");
  if (!secret || secret.length < 16) throw new KeystoreError("Saving API keys needs the KEYS_SECRET server secret (at least 16 characters).");
  if (derived?.secret === secret) return derived.key;
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("postdaily-api-keys"), info: new TextEncoder().encode("v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  derived = { secret, key };
  return key;
}

// The user and provider are bound into the ciphertext, so a row copied to another user or
// provider won't decrypt.
const aad = (userId: string, provider: KeyProvider) => new TextEncoder().encode(`${userId}:${provider}`);

export async function saveKey(userId: string, provider: KeyProvider, apiKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(userId, provider) },
    await cryptoKey(),
    new TextEncoder().encode(apiKey),
  );
  await db.run(
    `INSERT INTO api_keys (user_id, provider, ciphertext, iv, last4, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, last4 = excluded.last4, created_at = excluded.created_at`,
    userId,
    provider,
    b64(ct),
    b64(iv),
    apiKey.slice(-4),
    new Date().toISOString(),
  );
}

export async function deleteKey(userId: string, provider: KeyProvider) {
  await db.run("DELETE FROM api_keys WHERE user_id = ? AND provider = ?", userId, provider);
}

export async function listKeys(userId: string): Promise<StoredKey[]> {
  const rows = await db.all<{ provider: KeyProvider; last4: string; created_at: string }>(
    "SELECT provider, last4, created_at FROM api_keys WHERE user_id = ? ORDER BY provider",
    userId,
  );
  return rows.filter((r) => KEY_PROVIDERS.includes(r.provider)).map((r) => ({ provider: r.provider, last4: r.last4, addedAt: r.created_at }));
}

/** The user's own key, or null if they haven't added one (or it can't be decrypted). */
export async function getUserKey(userId: string, provider: KeyProvider): Promise<string | null> {
  const row = await db.get<{ ciphertext: string; iv: string }>(
    "SELECT ciphertext, iv FROM api_keys WHERE user_id = ? AND provider = ?",
    userId,
    provider,
  );
  if (!row || !canStoreKeys()) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(row.iv), additionalData: aad(userId, provider) },
      await cryptoKey(),
      unb64(row.ciphertext),
    );
    return new TextDecoder().decode(pt);
  } catch {
    console.warn(`[keys] couldn't decrypt the ${provider} key for ${userId} (was KEYS_SECRET changed?)`);
    return null;
  }
}

/** The key to use right now: the current user's own key, else the server's. */
export async function resolveKey(provider: KeyProvider): Promise<{ key: string; source: "user" | "server" } | null> {
  const userId = currentUserId();
  const own = userId ? await getUserKey(userId, provider) : null;
  if (own) return { key: own, source: "user" };
  const server = env(ENV_KEY[provider]);
  return server ? { key: server, source: "server" } : null;
}
