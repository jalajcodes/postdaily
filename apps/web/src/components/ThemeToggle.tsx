// Dark mode button: a moon in light mode, a sun in dark mode. Clicking it spreads the other
// theme out from the button like an eclipse (see theme/dark.ts).
import { useRef, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { eclipseTo, isDark, onThemeChange } from "../theme/dark";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const dark = useSyncExternalStore(onThemeChange, isDark, () => false);
  const btn = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    const r = btn.current!.getBoundingClientRect();
    eclipseTo(!dark, r.left + r.width / 2, r.top + r.height / 2);
  };

  return (
    <button
      ref={btn}
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={`theme-toggle relative grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 md:size-8 ${dark ? "is-dark" : ""} ${className}`}
    >
      <Moon className="icon-moon absolute size-5 md:size-4" />
      <Sun className="icon-sun absolute size-5 text-amber-400 md:size-4" />
    </button>
  );
}
