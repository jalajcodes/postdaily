// Types shared by the API server, the web app and (later) the mobile app.

export const AI_PROVIDERS = ["claude-code", "anthropic", "openai", "ollama"] as const;
export type AIProviderId = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AIProviderId, string> = {
  "claude-code": "Claude (my Claude login)",
  anthropic: "Anthropic API key",
  openai: "OpenAI API key",
  ollama: "Ollama (local)",
};

export const DEFAULT_MODELS: Record<AIProviderId, string> = {
  "claude-code": "claude-opus-5-5",
  anthropic: "claude-opus-5-5",
  openai: "gpt-5",
  ollama: "llama3.1",
};

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
}

export interface Profile {
  niche: string;
  audience: string;
  goals: string;
  topics: string[];
  samplePosts: string;
  styleGuide: string;
  bannedPhrases: string[];
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
  scheduledAt: string | null;
  publishedAt: string | null;
  linkedinUrn: string | null;
  error: string | null;
  ideaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Slot {
  id?: string;
  dayOfWeek: number; // 1 = Monday ... 7 = Sunday (ISO)
  time: string; // "HH:MM"
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

export interface AuthConfig {
  linkedinEnabled: boolean;
  devLoginEnabled: boolean;
}

/** LinkedIn shows roughly the first ~210 characters (or 3 lines) before "...see more". */
export const LINKEDIN_FOLD_CHARS = 210;
export const LINKEDIN_FOLD_LINES = 3;
export const LINKEDIN_MAX_CHARS = 3000;
