// A typed API client usable from the web app and a future React Native / Expo app.
import type {
  AppNotification,
  AuthConfig,
  Carousel,
  CarouselSlide,
  Draft,
  Idea,
  IdeaStatus,
  ModelOption,
  PlannedPost,
  Post,
  PostLength,
  Profile,
  ProviderStatus,
  PushConfig,
  RewriteAction,
  Settings,
  Slot,
  Stats,
  User,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  baseUrl: string;
  getToken: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void;
  /** IANA timezone of the device, used to default the user's timezone on first sign-in. */
  timezone?: string;
}

export function createClient(opts: ClientOptions) {
  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.getToken();
    const res = await fetch(`${opts.baseUrl}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.timezone ? { "X-Timezone": opts.timezone } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) opts.onUnauthorized?.();
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
    return data as T;
  }

  return {
    baseUrl: opts.baseUrl,
    auth: {
      config: () => req<AuthConfig>("GET", "/auth/config"),
      linkedinStartUrl: (redirect?: string) =>
        `${opts.baseUrl}/api/auth/linkedin/start${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`,
      /** For a signed-in user: get a LinkedIn authorize URL that links LinkedIn to this account. */
      linkLinkedin: (redirect?: string) =>
        req<{ url: string }>("POST", `/auth/linkedin/link${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`),
      devLogin: () => req<{ token: string }>("POST", "/auth/dev-login"),
      me: () => req<User>("GET", "/me"),
      logout: () => req<{ ok: true }>("POST", "/auth/logout"),
    },
    settings: {
      get: () => req<Settings>("GET", "/settings"),
      update: (s: Partial<Settings>) => req<Settings>("PUT", "/settings", s),
      providers: () => req<ProviderStatus[]>("GET", "/ai/providers"),
      /** Model list for providers that publish one (currently OpenRouter). */
      models: (provider: string) => req<ModelOption[]>("GET", `/ai/models?provider=${encodeURIComponent(provider)}`),
    },
    profile: {
      get: () => req<Profile>("GET", "/profile"),
      update: (p: Partial<Profile>) => req<Profile>("PUT", "/profile", p),
      analyze: () => req<Profile>("POST", "/profile/analyze"),
      clearLearned: () => req<Profile>("DELETE", "/profile/learned"),
    },
    ideas: {
      list: (status?: IdeaStatus) => req<Idea[]>("GET", `/ideas${status ? `?status=${status}` : ""}`),
      create: (text: string) => req<Idea>("POST", "/ideas", { text }),
      generate: () => req<Idea[]>("POST", "/ideas/generate"),
      update: (id: string, patch: { status?: IdeaStatus; text?: string }) =>
        req<Idea>("PATCH", `/ideas/${id}`, patch),
      remove: (id: string) => req<{ ok: true }>("DELETE", `/ideas/${id}`),
    },
    ai: {
      drafts: (input: string, length: PostLength) =>
        req<{ drafts: Draft[] }>("POST", "/ai/drafts", { input, length }),
      rewrite: (content: string, action: RewriteAction, instruction?: string) =>
        req<{ content: string }>("POST", "/ai/rewrite", { content, action, instruction }),
      hooks: (content: string) => req<{ hooks: string[] }>("POST", "/ai/hooks", { content }),
      carousel: (content: string) => req<Carousel>("POST", "/ai/carousel", { content }),
    },
    plan: {
      /** Free posting slots in the next `days` days (max 10). */
      slots: (days = 7) => req<{ slots: string[] }>("GET", `/plan/slots?days=${days}`),
      /** Write one draft per free slot, rotating through your content pillars. */
      /** `exclude`: slots already covered by drafts from an earlier, partial plan. */
      week: (days = 7, exclude: string[] = []) => req<{ items: PlannedPost[]; missing: number }>("POST", "/plan/week", { days, exclude }),
      schedule: (items: { postId: string; scheduledAt: string }[]) => req<{ posts: Post[] }>("POST", "/plan/schedule", { items }),
    },
    posts: {
      list: (status?: string) => req<Post[]>("GET", `/posts${status ? `?status=${status}` : ""}`),
      get: (id: string) => req<Post>("GET", `/posts/${id}`),
      create: (p: { content: string; ideaId?: string | null }) => req<Post>("POST", "/posts", p),
      /** `jitter` turns the random ±N minute buffer on/off for this post (defaults to the setting). */
      update: (
        id: string,
        p: { content?: string; scheduledAt?: string | null; jitter?: boolean; firstComment?: string | null; imageAlt?: string | null },
      ) =>
        req<Post>("PATCH", `/posts/${id}`, p),
      remove: (id: string) => req<{ ok: true }>("DELETE", `/posts/${id}`),
      queue: (id: string, opts?: { jitter?: boolean }) => req<Post>("POST", `/posts/${id}/queue`, opts ?? {}),
      unschedule: (id: string) => req<Post>("POST", `/posts/${id}/unschedule`),
      publish: (id: string) => req<Post>("POST", `/posts/${id}/publish`),
      /** Retry a failed post now. */
      retry: (id: string) => req<Post>("POST", `/posts/${id}/retry`),
      getImage: (id: string) => req<{ dataUrl: string }>("GET", `/posts/${id}/image`),
      setImage: (id: string, dataUrl: string, alt?: string) => req<Post>("PUT", `/posts/${id}/image`, { dataUrl, alt }),
      /** Removes the post's image or carousel. */
      removeImage: (id: string) => req<Post>("DELETE", `/posts/${id}/image`),
      setDocument: (id: string, doc: { dataUrl: string; title: string; slides: CarouselSlide[] }) =>
        req<Post>("PUT", `/posts/${id}/document`, doc),
    },
    slots: {
      get: () => req<Slot[]>("GET", "/slots"),
      put: (slots: Slot[]) => req<Slot[]>("PUT", "/slots", { slots }),
    },
    stats: () => req<Stats>("GET", "/stats"),
    push: {
      config: () => req<PushConfig>("GET", "/push/config"),
      subscribe: (endpoint: string) => req<{ ok: true }>("POST", "/push/subscribe", { endpoint }),
      unsubscribe: (endpoint: string) => req<{ ok: true }>("POST", "/push/unsubscribe", { endpoint }),
      test: () => req<{ sent: number }>("POST", "/push/test"),
    },
    notifications: {
      list: () => req<AppNotification[]>("GET", "/notifications"),
      markRead: () => req<{ ok: true }>("POST", "/notifications/read"),
    },
  };
}

export type ApiClient = ReturnType<typeof createClient>;
