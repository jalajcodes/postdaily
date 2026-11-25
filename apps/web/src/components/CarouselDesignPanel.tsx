// The carousel designer's style controls, in three tabs: Look, Background, Text & layout.
import { useDeferredValue, useMemo, useState, type ComponentType } from "react";
import {
  AlignCenter,
  AlignLeft,
  Brain,
  Briefcase,
  ChartColumn,
  CodeXml,
  Coffee,
  Compass,
  Flame,
  Globe,
  Handshake,
  Heart,
  Leaf,
  Lightbulb,
  Megaphone,
  MessageCircle,
  Mountain,
  Palette,
  PenTool,
  Puzzle,
  Rocket,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  ACCENT_PRESETS,
  CAROUSEL_FONTS,
  CAROUSEL_ILLUSTRATIONS,
  CAROUSEL_PATTERNS,
  CAROUSEL_THEMES,
  type CarouselDesign,
  type CarouselFont,
  type CarouselIllustration,
  type CarouselPattern,
  type CarouselTheme,
} from "@postdaily/shared";
import { patternSwatch } from "../lib/carousel";
import { Label, inputCls } from "./ui";

const ICONS: Record<Exclude<CarouselIllustration, "none">, ComponentType<{ className?: string }>> = {
  rocket: Rocket,
  lightbulb: Lightbulb,
  "trending-up": TrendingUp,
  "chart-column": ChartColumn,
  target: Target,
  megaphone: Megaphone,
  mountain: Mountain,
  sparkles: Sparkles,
  brain: Brain,
  handshake: Handshake,
  coffee: Coffee,
  briefcase: Briefcase,
  users: Users,
  compass: Compass,
  trophy: Trophy,
  flame: Flame,
  zap: Zap,
  heart: Heart,
  "message-circle": MessageCircle,
  "pen-tool": PenTool,
  "code-xml": CodeXml,
  puzzle: Puzzle,
  palette: Palette,
  globe: Globe,
  leaf: Leaf,
};

type Tab = "look" | "background" | "text";

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${value === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function CarouselDesignPanel({
  design,
  set,
  onReset,
}: {
  design: CarouselDesign;
  set: <K extends keyof CarouselDesign>(k: K, v: CarouselDesign[K]) => void;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<Tab>("look");
  // Pattern previews only depend on the colors, so they're redrawn when those change.
  const colors = useDeferredValue(
    useMemo(() => ({ ...design }), [design.theme, design.accent, design.accent2, design.intensity]), // eslint-disable-line react-hooks/exhaustive-deps
  );
  const swatches = useMemo(
    () =>
      tab === "background"
        ? (Object.keys(CAROUSEL_PATTERNS) as CarouselPattern[]).map((p) => [p, patternSwatch(colors, p)] as const)
        : [],
    [tab, colors],
  );

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            ["look", "Look"],
            ["background", "Background"],
            ["text", "Text & layout"],
          ]}
        />
        <button className="text-xs text-slate-500 hover:text-brand-600" onClick={onReset}>
          Reset to my brand defaults (Settings → Carousel brand)
        </button>
      </div>

      {tab === "look" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Style</Label>
            <select className={inputCls} value={design.theme} onChange={(e) => set("theme", e.target.value as CarouselTheme)}>
              {Object.entries(CAROUSEL_THEMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <Label>Font</Label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(CAROUSEL_FONTS) as [CarouselFont, (typeof CAROUSEL_FONTS)[CarouselFont]][]).map(([k, f]) => (
                <button
                  key={k}
                  onClick={() => set("font", k)}
                  style={{ fontFamily: `"${f.heading}"` }}
                  className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${design.font === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white hover:bg-slate-100"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Accent color</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => set("accent", c)}
                  className={`size-7 rounded-full border-2 ${design.accent.toLowerCase() === c ? "border-slate-900" : "border-white shadow"}`}
                  style={{ background: c }}
                  aria-label={`Accent ${c}`}
                />
              ))}
              <input
                type="color"
                value={design.accent}
                onChange={(e) => set("accent", e.target.value)}
                className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="Custom accent color"
              />
            </div>
          </div>
          <div>
            <Label hint="(gradients, mesh, confetti)">Second color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={design.accent2 ?? "#a855f7"}
                onChange={(e) => set("accent2", e.target.value)}
                className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="Second color"
              />
              {design.accent2 ? (
                <button className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600" onClick={() => set("accent2", undefined)}>
                  <X className="size-3" /> Use automatic
                </button>
              ) : (
                <span className="text-xs text-slate-500">Automatic (from the accent)</span>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "background" && (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <Label>Pattern</Label>
              <Segmented
                value={design.intensity ?? "normal"}
                onChange={(v) => set("intensity", v)}
                options={[
                  ["subtle", "Subtle"],
                  ["normal", "Normal"],
                  ["bold", "Bold"],
                ]}
              />
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
              {swatches.map(([key, src]) => (
                <button
                  key={key}
                  onClick={() => set("pattern", key)}
                  aria-pressed={design.pattern === key}
                  className={`overflow-hidden rounded-lg border-2 bg-white text-left ${design.pattern === key ? "border-brand-500" : "border-transparent hover:border-slate-300"}`}
                >
                  <img src={src} alt="" className="aspect-[4/5] w-full object-cover" />
                  <span className="block truncate px-1.5 py-1 text-[11px] text-slate-600">{CAROUSEL_PATTERNS[key]}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <Label hint="(large line art behind the slide)">Illustration</Label>
              <Segmented
                value={design.illustrationOn ?? "featured"}
                onChange={(v) => set("illustrationOn", v)}
                options={[
                  ["featured", "Cover & last slide"],
                  ["all", "Every slide"],
                ]}
              />
            </div>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9 lg:grid-cols-13">
              <button
                onClick={() => set("illustration", "none")}
                aria-pressed={!design.illustration || design.illustration === "none"}
                title="None"
                className={`flex aspect-square items-center justify-center rounded-lg border-2 bg-white text-xs text-slate-500 ${
                  !design.illustration || design.illustration === "none" ? "border-brand-500" : "border-transparent hover:border-slate-300"
                }`}
              >
                None
              </button>
              {(Object.keys(ICONS) as Exclude<CarouselIllustration, "none">[]).map((id) => {
                const Icon = ICONS[id];
                return (
                  <button
                    key={id}
                    onClick={() => set("illustration", id)}
                    aria-pressed={design.illustration === id}
                    title={CAROUSEL_ILLUSTRATIONS[id]}
                    aria-label={`Illustration: ${CAROUSEL_ILLUSTRATIONS[id]}`}
                    className={`flex aspect-square items-center justify-center rounded-lg border-2 bg-white ${
                      design.illustration === id ? "border-brand-500 text-brand-600" : "border-transparent text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <Icon className="size-5" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "text" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Alignment</Label>
            <Segmented
              value={design.align ?? "left"}
              onChange={(v) => set("align", v)}
              options={[
                ["left", <><AlignLeft className="size-4" /> Left</>],
                ["center", <><AlignCenter className="size-4" /> Center</>],
              ]}
            />
          </div>
          <div>
            <Label>Text size</Label>
            <Segmented
              value={design.textSize ?? "m"}
              onChange={(v) => set("textSize", v)}
              options={[
                ["s", "Small"],
                ["m", "Medium"],
                ["l", "Large"],
              ]}
            />
          </div>
          <div>
            <Label hint="(*starred* words)">Highlight style</Label>
            <Segmented
              value={design.highlight ?? "auto"}
              onChange={(v) => set("highlight", v)}
              options={[
                ["auto", "Auto"],
                ["color", "Color"],
                ["marker", "Marker"],
                ["underline", "Underline"],
                ["pill", "Pill"],
              ]}
            />
          </div>
          <div>
            <Label>Footer</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <Toggle label="Page numbers" checked={design.pageNumbers !== false} onChange={(v) => set("pageNumbers", v)} />
              <Toggle label="Progress bar" checked={design.progressBar !== false} onChange={(v) => set("progressBar", v)} />
              <Toggle label="Swipe cue on cover" checked={design.swipeCue !== false} onChange={(v) => set("swipeCue", v)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
