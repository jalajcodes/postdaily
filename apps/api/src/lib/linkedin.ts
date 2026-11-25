// LinkedIn OAuth (OpenID Connect) and posting via the Posts API.
import { env } from "../runtime/env";

export const linkedinEnabled = () => Boolean(env("LINKEDIN_CLIENT_ID") && env("LINKEDIN_CLIENT_SECRET"));

const redirectUri = (apiUrl: string) => `${apiUrl}/api/auth/linkedin/callback`;
const SCOPES = ["openid", "profile", "email", "w_member_social"];

export function authorizeUrl(apiUrl: string, state: string) {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: env("LINKEDIN_CLIENT_ID")!,
    redirect_uri: redirectUri(apiUrl),
    state,
    scope: SCOPES.join(" "),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
}

export async function exchangeCode(apiUrl: string, code: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(apiUrl),
      client_id: env("LINKEDIN_CLIENT_ID")!,
      client_secret: env("LINKEDIN_CLIENT_SECRET")!,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function fetchUserInfo(accessToken: string) {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LinkedIn userinfo failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { sub: string; name: string; email?: string; picture?: string };
}

/**
 * LinkedIn's "commentary" field uses Little Text Format: reserved characters must be
 * backslash-escaped or the post gets truncated. Hashtags become hashtag templates.
 */
export function toLittleText(text: string) {
  const escape = (t: string) => t.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  // Hashtags first, so a tag like #ship_it isn't cut at the (escaped) underscore.
  return text
    .split(/(#[\p{L}\p{N}_]+)/u)
    .map((part, i) => (i % 2 ? `{hashtag|\\#|${escape(part.slice(1))}}` : escape(part)))
    .join("");
}

/** A LinkedIn API error. `temporary` = safe to retry later (rate limit or LinkedIn outage). */
export class LinkedInError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
  get temporary() {
    return this.status === 429 || this.status >= 500;
  }
}

const restHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  "LinkedIn-Version": env("LINKEDIN_API_VERSION") ?? "202606",
  "X-Restli-Protocol-Version": "2.0.0",
});

async function fail(what: string, res: Response): Promise<never> {
  throw new LinkedInError(`LinkedIn ${what} failed: ${res.status} ${(await res.text()).slice(0, 500)}`, res.status);
}

/** Upload a file (data URL) via the Images or Documents API and return its URN. */
async function uploadAsset(kind: "image" | "document", accessToken: string, personSub: string, dataUrl: string) {
  const init = await fetch(`https://api.linkedin.com/rest/${kind}s?action=initializeUpload`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${personSub}` } }),
  });
  if (!init.ok) await fail(`${kind} upload setup`, init);
  const { value } = (await init.json()) as { value: { uploadUrl: string; image?: string; document?: string } };

  const [meta, b64] = dataUrl.split(",", 2);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const put = await fetch(value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": meta.match(/data:([^;]+)/)?.[1] ?? "application/octet-stream" },
    body: bytes,
  });
  if (!put.ok) await fail(`${kind} upload`, put);
  return (kind === "image" ? value.image : value.document)!;
}

export const uploadImage = (accessToken: string, personSub: string, dataUrl: string) =>
  uploadAsset("image", accessToken, personSub, dataUrl);

/**
 * Upload a PDF via the Documents API. LinkedIn processes documents after upload, so wait
 * (briefly) until it reports AVAILABLE before it's attached to a post.
 */
export async function uploadDocument(
  accessToken: string,
  personSub: string,
  dataUrl: string,
  { tries = 8, delayMs = 1500 } = {},
): Promise<string> {
  const urn = await uploadAsset("document", accessToken, personSub, dataUrl);
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`https://api.linkedin.com/rest/documents/${encodeURIComponent(urn)}`, { headers: restHeaders(accessToken) });
    if (res.ok) {
      const { status } = (await res.json()) as { status?: string };
      if (status === "AVAILABLE") return urn;
      if (status === "PROCESSING_FAILED") throw new LinkedInError("LinkedIn couldn't process the carousel PDF.", 422);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return urn; // Still processing: try posting anyway; LinkedIn usually accepts it.
}

export type PostMedia = { urn: string; alt?: string | null; title?: string | null };

export async function publishPost(
  accessToken: string,
  personSub: string,
  content: string,
  media?: PostMedia,
): Promise<string> {
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify({
      author: `urn:li:person:${personSub}`,
      commentary: toLittleText(content),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(media
        ? {
            content: {
              media: {
                id: media.urn,
                ...(media.title ? { title: media.title.slice(0, 400) } : {}),
                ...(media.alt ? { altText: media.alt.slice(0, 4000) } : {}),
              },
            },
          }
        : {}),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (res.status !== 201) await fail("post", res);
  return res.headers.get("x-restli-id") ?? "";
}

/** Comment on your own post (used for the "first comment", e.g. a link). Returns the comment URN. */
export async function commentOnPost(accessToken: string, personSub: string, postUrn: string, text: string): Promise<string> {
  const res = await fetch(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postUrn)}/comments`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify({ actor: `urn:li:person:${personSub}`, object: postUrn, message: { text } }),
  });
  if (!res.ok) await fail("comment", res);
  return res.headers.get("x-restli-id") ?? "";
}
