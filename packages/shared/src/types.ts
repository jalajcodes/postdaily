// Types shared by the API server, the web app and (later) the mobile app.

export const AI_PROVIDERS = ["claude-code", "anthropic", "openrouter", "openai", "ollama"] as const;
export type AIProviderId = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AIProviderId, string> = {
  "claude-code": "Claude (my Claude login)",
  anthropic: "Anthropic API key",
  openrouter: "OpenRouter (free models available)",
  openai: "OpenAI API key",
  ollama: "Ollama (local)",
};

export const DEFAULT_MODELS: Record<AIProviderId, string> = {
  "claude-code": "claude-opus-5-5",
  anthropic: "claude-opus-5-5",
  // Fastest free model with good writing in a Nov 2026 test (~9 s for 3 drafts).
  openrouter: "particle-ai/particle-1:free",
  openai: "gpt-5",
  ollama: "llama3.1",
};

export interface ModelOption {
  id: string;
  name: string;
  contextLength: number | null;
  free: boolean;
}

export const POST_LENGTHS = ["short", "medium", "long"] as const;
export type PostLength = (typeof POST_LENGTHS)[number];

export const REWRITE_ACTIONS = {
  new_hook: "New hook",
  shorter: "Shorter",
  longer: "Longer",
  casual: "More casual",
  professional: "More professional",
  punchier: "Punchier",
  add_cta: "Add a question/CTA",
  fix_formatting: "Fix formatting",
  custom: "Custom instruction",
} as const;
export type RewriteAction = keyof typeof REWRITE_ACTIONS;

export type PostStatus = "draft" | "queued" | "publishing" | "published" | "failed";
export type IdeaStatus = "new" | "used" | "dismissed";
export type IdeaSource = "ai" | "me";

export interface User {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
  linkedinConnected: boolean;
  linkedinExpiresAt: string | null;
}

export interface Settings {
  aiProvider: AIProviderId;
  aiModel: string;
  defaultLength: PostLength;
  timezone: string;
  reminderEnabled: boolean;
  reminderTime: string; // "HH:MM" in user's timezone
  weeklyGoal: number;
  dailyIdeas: boolean;
  /** Shift each scheduled post by a random amount within ±jitterMinutes. */
  jitterEnabled: boolean;
  jitterMinutes: number;
  /** Push a "reply to comments now" nudge ~40 minutes after a post goes live. */
  engagementNudge: boolean;
}

/**
 * Posting-time presets. Times come from 2026 engagement studies:
 * Buffer (4.8M posts) found weekday 3-8 PM strongest; Sprout Social found 11 AM-5 PM strongest
 * (Tue-Thu); and twice-a-day posts should be ~7 hours apart so they don't compete for reach.
 */
export const POSTING_PRESETS = {
  twice: {
    label: "Twice a day",
    description: "Weekdays at 10:00 and 17:00 (7 hours apart)",
    slots: [1, 2, 3, 4, 5].flatMap((d) => [
      { dayOfWeek: d, time: "10:00" },
      { dayOfWeek: d, time: "17:00" },
    ]),
  },
  once: {
    label: "Once a day",
    description: "Weekdays at 16:00",
    slots: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, time: "16:00" })),
  },
} as const;
export type PostingPreset = keyof typeof POSTING_PRESETS;

export interface Profile {
  niche: string;
  audience: string;
  goals: string;
  topics: string[];
  samplePosts: string;
  styleGuide: string;
  bannedPhrases: string[];
  /** How many of your recently published posts are used as voice examples. */
  learnedCount: number;
  /** Content pillars: the 2-5 recurring themes "Plan my week" rotates through. */
  pillars: string[];
  updatedAt: string | null;
}

export interface Idea {
  id: string;
  text: string;
  source: IdeaSource;
  status: IdeaStatus;
  forDate: string | null;
  createdAt: string;
}

export interface Post {
  id: string;
  content: string;
  status: PostStatus;
  /** The slot/time you picked. */
  scheduledAt: string | null;
  /** When it will actually go out (scheduledAt plus the random buffer). */
  publishAt: string | null;
  /** 0 = exact time; otherwise the random buffer (±minutes) applied. */
  jitterMinutes: number;
  publishedAt: string | null;
  linkedinUrn: string | null;
  error: string | null;
  ideaId: string | null;
  /** Automatic retries used after temporary LinkedIn errors. */
  retryCount: number;
  /** Comment posted right after the post (good for links). */
  firstComment: string | null;
  commentError: string | null;
  hasImage: boolean;
  imageAlt: string | null;
  /** A PDF carousel is attached instead of an image. */
  hasDocument: boolean;
  documentTitle: string | null;
  carouselSlides: CarouselSlide[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface Slot {
  id?: string;
  dayOfWeek: number; // 1 = Monday ... 7 = Sunday (ISO)
  time: string; // "HH:MM"
}

export interface CarouselSlide {
  heading: string;
  body: string;
}

export interface Carousel {
  title: string;
  slides: CarouselSlide[];
}

/** One post from "Plan my week": a saved draft and the slot it's meant for. */
export interface PlannedPost {
  post: Post;
  pillar: string;
  slot: string;
}

export interface Draft {
  angle: string;
  content: string;
}

export interface ProviderStatus {
  id: AIProviderId;
  label: string;
  available: boolean;
  note: string;
}

export interface Stats {
  dailyStreak: number;
  weeklyStreak: number;
  thisWeek: number;
  weeklyGoal: number;
  totalPublished: number;
  postedToday: boolean;
  queuedToday: boolean;
  nextScheduled: Post | null;
  heatmap: { date: string; count: number }[]; // last 84 days
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface AuthConfig {
  linkedinEnabled: boolean;
  devLoginEnabled: boolean;
}

/** LinkedIn shows roughly the first ~210 characters (or 3 lines) before "...see more". */
export const LINKEDIN_FOLD_CHARS = 210;
export const LINKEDIN_FOLD_LINES = 3;
/** On phones LinkedIn cuts sooner. */
export const LINKEDIN_FOLD_CHARS_MOBILE = 140;
export type PreviewDevice = "desktop" | "mobile";
/** Images are resized in the browser to stay under this (fits a D1 row). */
export const MAX_IMAGE_BYTES = 900_000;
export const LINKEDIN_MAX_CHARS = 3000;
/** Carousel PDFs are stored as base64 in a D1 row (2 MB max), so keep the PDF under this. */
export const MAX_DOCUMENT_BYTES = 1_400_000;
/** Minutes after publishing to send the "reply to comments" nudge. */
export const NUDGE_AFTER_MIN = 40;
