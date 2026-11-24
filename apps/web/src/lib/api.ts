import { createClient } from "@postdaily/shared";

const TOKEN_KEY = "postdaily.token";

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// In dev, Vite proxies /api to the API server; in production the API serves the web app.
export const api = createClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  getToken: tokenStore.get,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  onUnauthorized: () => {
    if (tokenStore.get()) {
      tokenStore.clear();
      window.location.href = "/login";
    }
  },
});

export const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatWhen(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}
