// Web Push without payloads: we only send a VAPID-signed "wake up" ping. The service worker then
// fetches the unread notifications itself. No payload means no message encryption is needed, and
// it works the same on Node and Cloudflare (WebCrypto only).
import { db, newId } from "../db";
import { env } from "../runtime/env";

export const pushEnabled = () => Boolean(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

let signingKey: { pk: string; key: CryptoKey } | null = null;
async function getSigningKey() {
  const pub = env("VAPID_PUBLIC_KEY")!;
  if (signingKey?.pk === pub) return signingKey.key;
  const raw = fromB64url(pub); // 65-byte uncompressed P-256 point: 0x04 || x || y
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: b64url(raw.slice(1, 33)),
      y: b64url(raw.slice(33, 65)),
      d: env("VAPID_PRIVATE_KEY")!,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  signingKey = { pk: pub, key };
  return key;
}

async function vapidHeader(endpoint: string) {
  const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env("VAPID_SUBJECT") ?? "mailto:postdaily@example.com",
  })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await getSigningKey(), new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env("VAPID_PUBLIC_KEY")}`;
}

/** Wake every device the user subscribed. Dead subscriptions are removed. Returns how many got it. */
export async function sendPush(userId: string): Promise<number> {
  if (!pushEnabled()) return 0;
  const subs = await db.all<{ id: string; endpoint: string }>("SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?", userId);
  let sent = 0;
  for (const s of subs) {
    try {
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { Authorization: await vapidHeader(s.endpoint), TTL: "86400", Urgency: "normal", "Content-Length": "0" },
      });
      if (res.status === 404 || res.status === 410) await db.run("DELETE FROM push_subscriptions WHERE id = ?", s.id);
      else if (res.ok) sent++;
      else console.warn(`[push] ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      console.warn("[push]", (e as Error).message);
    }
  }
  return sent;
}

export async function saveSubscription(userId: string, endpoint: string) {
  await db.run(
    "INSERT INTO push_subscriptions (id, user_id, endpoint) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id",
    newId(),
    userId,
    endpoint,
  );
}
