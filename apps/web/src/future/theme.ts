// Futuristic mode switch. The choice is cached in localStorage so the theme is applied on
// first paint (no flash of the light theme while settings load).
const KEY = "postdaily.futuristic";

export const isFuture = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "future";

export function applyFuture(on: boolean) {
  const root = document.documentElement;
  if (on) root.dataset.theme = "future";
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", on ? "#050712" : "#0a66c2");
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}

/** Called once before React renders. */
export function applySavedFuture() {
  try {
    if (localStorage.getItem(KEY) === "1") applyFuture(true);
  } catch {}
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
