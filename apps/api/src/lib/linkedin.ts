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
  const escaped = text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  return escaped.replace(/\\#([\p{L}\p{N}_]+)/gu, "{hashtag|\\#|$1}");
}

export async function publishPost(accessToken: string, personSub: string, content: string): Promise<string> {
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": env("LINKEDIN_API_VERSION") ?? "202606",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:person:${personSub}`,
      commentary: toLittleText(content),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (res.status !== 201) throw new Error(`LinkedIn post failed: ${res.status} ${await res.text()}`);
  return res.headers.get("x-restli-id") ?? "";
}
