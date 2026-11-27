// Dark mode: the choice is kept on this device (it follows the system setting until you pick
// one) and applied before React renders, so there's no flash of the wrong theme.
// Switching runs an "eclipse": the new theme spreads from the switch in a growing circle with a
// glowing corona at its edge (View Transitions API; instant where it isn't supported or when
// the device asks for reduced motion).
const KEY = "postdaily.dark";
const EVENT = "postdaily:theme";

export const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

export function applyDark(on: boolean, save = true) {
  document.documentElement.classList.toggle("dark", on);
  if (document.documentElement.dataset.theme !== "future")
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", on ? "#0d1117" : "#0a66c2");
  if (save)
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  window.dispatchEvent(new Event(EVENT));
}

/** Called once before React renders. */
export function applySavedDark() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* private mode */
  }
  const system = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  applyDark(saved === null ? system : saved === "1", false);
}

export function onThemeChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const DURATION = 900;
/** Smooth start, smooth stop, without a long crawl at the end. */
const EASING = "cubic-bezier(0.45, 0, 0.2, 1)";

/**
 * The radius and the glow are registered as typed properties so they can be animated; the
 * reveal and the corona both read them, so they move in lockstep.
 */
let registered: boolean | null = null;
function registerProps() {
  if (registered !== null) return registered;
  try {
    CSS.registerProperty({ name: "--eclipse-r", syntax: "<length>", inherits: true, initialValue: "0px" });
    CSS.registerProperty({ name: "--eclipse-glow", syntax: "<number>", inherits: true, initialValue: "1" });
    registered = true;
  } catch (e) {
    // Already registered (e.g. after a hot reload) is fine; anything else means no support.
    registered = (e as Error)?.name === "InvalidModificationError";
  }
  return registered;
}

let running = false;

/** Switch theme with the eclipse animation, spreading from the point (x, y). */
export async function eclipseTo(on: boolean, x: number, y: number) {
  type VT = { ready: Promise<void>; finished: Promise<void> };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
  if (running || !doc.startViewTransition || !("registerProperty" in CSS) || reducedMotion() || !registerProps()) return applyDark(on);
  running = true;

  const root = document.documentElement;
  // Far enough to cover the farthest corner, plus the corona's width so it leaves the screen.
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 140;
  root.style.setProperty("--eclipse-x", `${x}px`);
  root.style.setProperty("--eclipse-y", `${y}px`);
  root.style.setProperty("--eclipse-r", "0px");
  root.classList.add(on ? "eclipse-to-dark" : "eclipse-to-light");
  const corona = document.createElement("div");
  corona.className = "eclipse-corona";
  corona.setAttribute("aria-hidden", "true");

  try {
    const t = doc.startViewTransition(() => {
      applyDark(on);
      document.body.appendChild(corona);
    });
    await t.ready;
    const grow = root.animate(
      [
        { "--eclipse-r": "0px", "--eclipse-glow": 1 },
        { "--eclipse-glow": 1, offset: 0.8 },
        { "--eclipse-r": `${radius}px`, "--eclipse-glow": 0 },
      ] as Keyframe[],
      { duration: DURATION, easing: EASING, fill: "forwards" },
    );
    // The transition lasts as long as its own layers animate; this does nothing visible but
    // keeps it running for the whole eclipse.
    root.animate({ opacity: [1, 1] }, { duration: DURATION, pseudoElement: "::view-transition-new(root)" });
    await t.finished;
    grow.cancel();
  } catch {
    applyDark(on);
  } finally {
    corona.remove();
    root.classList.remove("eclipse-to-dark", "eclipse-to-light");
    for (const p of ["--eclipse-x", "--eclipse-y", "--eclipse-r"]) root.style.removeProperty(p);
    running = false;
  }
}
