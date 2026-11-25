import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Copy, GalleryHorizontal, ImagePlus, Palette, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import {
  ACCENT_PRESETS,
  CAROUSEL_FONTS,
  CAROUSEL_PATTERNS,
  CAROUSEL_THEMES,
  MAX_CAROUSEL_SLIDES,
  MAX_SLIDE_IMAGES,
  SLIDE_TYPES,
  type CarouselBrand,
  type CarouselDesign,
  type CarouselFont,
  type CarouselPattern,
  type CarouselSlide,
  type CarouselTheme,
  type SlideType,
} from "@postdaily/shared";
import { api } from "../lib/api";
import { buildCarouselPdf, drawSlide, prepareSlideImage, slideThumbnails, slideTypeOf } from "../lib/carousel";
import { useCarouselAssets } from "../lib/useCarousel";
import { Button, ErrorText, Label, Spinner, inputCls } from "./ui";

export interface CarouselDoc {
  dataUrl: string;
  title: string;
  slides: CarouselSlide[];
  design: CarouselDesign;
}

const designOf = (b: CarouselBrand): CarouselDesign => ({ theme: b.theme, pattern: b.pattern, font: b.font, accent: b.accent });

/** A blank slide of the given type, with placeholder content. */
function blank(type: SlideType): CarouselSlide {
  switch (type) {
    case "list":
    case "checklist":
      return { type, heading: "", body: "", items: ["", "", ""] };
    case "compare":
      return { type, heading: "", body: "", labels: ["Before", "After"], items: ["", ""], items2: ["", ""] };
    case "stat":
      return { type, heading: "", body: "", stat: "" };
    default:
      return { type, heading: "", body: "" };
  }
}

/** Edit a carousel's design and slides with a live preview, then build the PDF and hand it back. */
export function CarouselEditor({
  initialTitle,
  initialSlides,
  initialDesign,
  brand,
  name,
  postContent,
  onSave,
  onCancel,
}: {
  initialTitle: string;
  initialSlides: CarouselSlide[];
  initialDesign: CarouselDesign | null;
  brand: CarouselBrand;
  name: string;
  postContent: string;
  onSave: (doc: CarouselDoc) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [slides, setSlides] = useState<CarouselSlide[]>(initialSlides.map((s, i) => ({ ...s, type: slideTypeOf(s, i) })));
  const [design, setDesign] = useState<CarouselDesign>(initialDesign ?? designOf(brand));
  const [sel, setSel] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [instruction, setInstruction] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // Phones: the style controls start folded so the slides are on screen first.
  const [showDesign, setShowDesign] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);
  // The page behind the designer shouldn't scroll while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const assets = useCarouselAssets(design, brand, name, slides);
  const deferredSlides = useDeferredValue(slides);
  const deferredDesign = useDeferredValue(design);
  const thumbs = useMemo(
    () => (assets ? slideThumbnails(deferredSlides, deferredDesign, assets, 220) : []),
    [deferredSlides, deferredDesign, assets],
  );
  const current = slides[Math.min(sel, slides.length - 1)];
  const big = useMemo(() => {
    if (!assets || !current) return null;
    const { canvas } = drawSlide(current, sel, slides.length, deferredDesign, assets);
    const c = document.createElement("canvas");
    c.width = 720;
    c.height = 900;
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(canvas, 0, 0, 720, 900);
    return c.toDataURL("image/jpeg", 0.9);
  }, [current, sel, slides.length, deferredDesign, assets]);

  const update = (patch: Partial<CarouselSlide>) => setSlides(slides.map((s, j) => (j === sel ? { ...s, ...patch } : s)));
  const move = (d: -1 | 1) => {
    const next = [...slides];
    [next[sel], next[sel + d]] = [next[sel + d], next[sel]];
    setSlides(next);
    setSel(sel + d);
  };
  const insert = (slide: CarouselSlide) => {
    const at = Math.min(sel + 1, slides.length);
    setSlides([...slides.slice(0, at), slide, ...slides.slice(at)]);
    setSel(at);
  };
  const changeType = (type: SlideType) => {
    const b = blank(type);
    update({
      type,
      items: current.items?.length ? current.items : b.items,
      items2: type === "compare" ? (current.items2?.length ? current.items2 : b.items2) : current.items2,
      labels: type === "compare" ? (current.labels ?? b.labels) : current.labels,
      stat: type === "stat" ? (current.stat ?? "") : current.stat,
    });
  };

  const covers = useMutation({ mutationFn: () => api.ai.coverHeadlines(postContent || title, current.heading) });
  const rewrite = useMutation({
    mutationFn: () => api.ai.rewriteSlide(postContent || title, current, instruction || undefined),
    onSuccess: ({ slide }, _v) => {
      setSlides((all) => all.map((s, j) => (j === sel ? slide : s)));
      setInstruction("");
    },
  });
  const [imageError, setImageError] = useState<unknown>(null);
  const imageCount = slides.filter((s) => s.image).length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!assets) throw new Error("Still loading fonts and images, try again in a second");
      const clean = slides
        .map((s) => ({
          ...s,
          heading: s.heading.trim(),
          body: s.body.trim(),
          ...(s.items ? { items: s.items.map((t) => t.trim()).filter(Boolean) } : {}),
          ...(s.items2 ? { items2: s.items2.map((t) => t.trim()).filter(Boolean) } : {}),
        }))
        .filter((s) => s.heading || s.body || s.items?.length || s.image || s.stat);
      if (clean.length < 2) throw new Error("A carousel needs at least 2 slides");
      const t = title.trim() || "Carousel";
      const dataUrl = await buildCarouselPdf(clean, t, design, assets);
      await onSave({ dataUrl, title: t, slides: clean, design });
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const setD = <K extends keyof CarouselDesign>(k: K, v: CarouselDesign[K]) => setDesign((d) => ({ ...d, [k]: v }));
  const type = current ? slideTypeOf(current, sel) : "text";
  const overflowCount = thumbs.filter((t) => t.overflow).length;

  return (
    <div className="space-y-4">
      {/* Design */}
      <button
        className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-3 py-3 text-left text-sm font-medium md:hidden"
        onClick={() => setShowDesign(!showDesign)}
        aria-expanded={showDesign}
      >
        <Palette className="size-4 text-brand-500" />
        <span className="flex-1">
          Style, pattern, font &amp; color
          <span className="block text-xs font-normal text-slate-500">
            {CAROUSEL_THEMES[design.theme].split(":")[0]} · {CAROUSEL_PATTERNS[design.pattern]} · {CAROUSEL_FONTS[design.font].label}
          </span>
        </span>
        <span className="size-4 rounded-full" style={{ background: design.accent }} />
        <ChevronDown className={`size-4 transition-transform ${showDesign ? "rotate-180" : ""}`} />
      </button>
      <div className={`grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4 ${showDesign ? "" : "hidden md:grid"}`}>
        <div>
          <Label>Style</Label>
          <select className={inputCls} value={design.theme} onChange={(e) => setD("theme", e.target.value as CarouselTheme)}>
            {Object.entries(CAROUSEL_THEMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Background pattern</Label>
          <select className={inputCls} value={design.pattern} onChange={(e) => setD("pattern", e.target.value as CarouselPattern)}>
            {Object.entries(CAROUSEL_PATTERNS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Font</Label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(CAROUSEL_FONTS) as [CarouselFont, (typeof CAROUSEL_FONTS)[CarouselFont]][]).map(([k, f]) => (
              <button
                key={k}
                onClick={() => setD("font", k)}
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
                onClick={() => setD("accent", c)}
                className={`size-7 rounded-full border-2 ${design.accent.toLowerCase() === c ? "border-slate-900" : "border-white shadow"}`}
                style={{ background: c }}
                aria-label={`Accent ${c}`}
              />
            ))}
            <input
              type="color"
              value={design.accent}
              onChange={(e) => setD("accent", e.target.value)}
              className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
              aria-label="Custom accent color"
            />
          </div>
        </div>
        <button className="justify-self-start text-xs text-slate-500 hover:text-brand-600 sm:col-span-2 lg:col-span-4" onClick={() => setDesign(designOf(brand))}>
          Reset to my brand defaults (Settings → Carousel brand)
        </button>
      </div>

      {/* Slide strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {!assets && <Spinner />}
        {thumbs.map((t, i) => (
          <button
            key={i}
            onClick={() => setSel(i)}
            className={`relative shrink-0 rounded-md border-2 ${i === sel ? "border-brand-500" : "border-transparent"}`}
            aria-label={`Edit slide ${i + 1}`}
          >
            <img src={t.src} alt="" className="h-32 rounded" />
            {t.overflow && (
              <span className="absolute top-1 right-1 rounded-full bg-amber-500 p-0.5 text-white" title="Text is squeezed on this slide">
                <AlertTriangle className="size-3" />
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => insert(blank("text"))}
          disabled={slides.length >= MAX_CAROUSEL_SLIDES}
          className="flex h-32 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-200 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus className="size-4" /> Add slide
        </button>
      </div>
      {overflowCount > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="size-3.5" /> {overflowCount} slide{overflowCount === 1 ? " has" : "s have"} more text than fits. Shorten
          {overflowCount === 1 ? " it" : " them"} so nothing gets cut.
        </p>
      )}

      {current && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,380px)_1fr]">
          <div>{big ? <img src={big} alt={`Slide ${sel + 1} preview`} className="w-full rounded-lg border border-slate-200 shadow-sm" /> : <Spinner />}</div>

          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Slide {sel + 1}</span>
              <select className={`${inputCls} w-auto py-1 text-sm`} value={type} onChange={(e) => changeType(e.target.value as SlideType)}>
                {Object.entries(SLIDE_TYPES).map(([k, v]) => (
                  <option key={k} value={k} disabled={k === "image" && type !== "image" && imageCount >= MAX_SLIDE_IMAGES}>
                    {v}
                  </option>
                ))}
              </select>
              <span className="flex-1" />
              <IconBtn label="Move left" disabled={sel === 0} onClick={() => move(-1)}>
                <ArrowUp className="size-4 -rotate-90" />
              </IconBtn>
              <IconBtn label="Move right" disabled={sel === slides.length - 1} onClick={() => move(1)}>
                <ArrowDown className="size-4 -rotate-90" />
              </IconBtn>
              <IconBtn
                label="Duplicate"
                disabled={slides.length >= MAX_CAROUSEL_SLIDES || (!!current.image && imageCount >= MAX_SLIDE_IMAGES)}
                onClick={() => insert({ ...current })}
              >
                <Copy className="size-4" />
              </IconBtn>
              <IconBtn
                label="Delete slide"
                disabled={slides.length <= 2}
                onClick={() => {
                  setSlides(slides.filter((_, j) => j !== sel));
                  setSel(Math.max(0, sel - 1));
                }}
              >
                <Trash2 className="size-4" />
              </IconBtn>
            </div>

            <Field label={type === "quote" ? "Quote" : type === "stat" ? "What the number means" : "Heading"} hint="*stars* highlight words">
              <textarea className={`${inputCls} min-h-14 resize-y font-medium`} maxLength={200} value={current.heading} onChange={(e) => update({ heading: e.target.value })} />
            </Field>
            {type === "cover" && (
              <div className="rounded-lg border border-slate-200 p-2">
                <Button variant="secondary" className="py-1 text-xs" loading={covers.isPending} onClick={() => covers.mutate()}>
                  <Sparkles className="size-3.5" /> {covers.data ? "3 more headlines" : "Try 3 cover headlines"}
                </Button>
                {covers.data && (
                  <ul className="mt-2 space-y-1">
                    {covers.data.headlines.map((h) => (
                      <li key={h}>
                        <button className="w-full rounded-md bg-slate-50 px-2.5 py-1.5 text-left text-sm hover:bg-brand-50" onClick={() => update({ heading: h })}>
                          {h}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <ErrorText error={covers.error} />
              </div>
            )}
            {type === "stat" && (
              <Field label="Big number">
                <input className={inputCls} maxLength={24} placeholder="e.g. 3x, 47%, $12k" value={current.stat ?? ""} onChange={(e) => update({ stat: e.target.value })} />
              </Field>
            )}
            {(type === "list" || type === "checklist") && (
              <Items label={type === "list" ? "Points" : "Checklist items"} items={current.items ?? []} onChange={(items) => update({ items })} />
            )}
            {type === "compare" && (
              <div className="grid gap-2 sm:grid-cols-2">
                {([0, 1] as const).map((c) => (
                  <div key={c} className="space-y-1.5">
                    <input
                      className={`${inputCls} font-medium`}
                      maxLength={40}
                      value={(current.labels ?? ["Before", "After"])[c]}
                      onChange={(e) => {
                        const labels = [...(current.labels ?? ["Before", "After"])] as [string, string];
                        labels[c] = e.target.value;
                        update({ labels });
                      }}
                    />
                    <Items
                      label=""
                      items={(c ? current.items2 : current.items) ?? []}
                      onChange={(items) => update(c ? { items2: items } : { items })}
                    />
                  </div>
                ))}
              </div>
            )}
            {type === "image" && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    setImageError(null);
                    try {
                      update({ image: await prepareSlideImage(f) });
                    } catch (err) {
                      setImageError(err);
                    }
                  }}
                />
                <Button variant="secondary" className="py-1.5 text-xs" onClick={() => fileInput.current?.click()}>
                  <ImagePlus className="size-3.5" /> {current.image ? "Replace image" : "Add a screenshot or photo"}
                </Button>
                {current.image && (
                  <button className="text-xs text-slate-500 hover:text-red-600" onClick={() => update({ image: undefined })}>
                    Remove image
                  </button>
                )}
                <ErrorText error={imageError} />
              </div>
            )}
            {type !== "compare" && (
              <Field label={type === "quote" ? "Who said it" : type === "cta" ? "Nudge (e.g. Follow for more on …)" : type === "image" ? "Caption" : "Text"}>
                <textarea className={`${inputCls} min-h-16 resize-y`} maxLength={600} value={current.body} onChange={(e) => update({ body: e.target.value })} />
              </Field>
            )}

            <div className="flex gap-2">
              <input
                className={inputCls}
                placeholder="Rewrite this slide… (optional: “make it a checklist”, “shorter”)"
                value={instruction}
                maxLength={300}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && rewrite.mutate()}
              />
              <Button variant="secondary" loading={rewrite.isPending} onClick={() => rewrite.mutate()}>
                <Wand2 className="size-4" /> Rewrite
              </Button>
            </div>
            <ErrorText error={rewrite.error} />
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 pt-3">
        <Label hint="(shown above the carousel on LinkedIn)">Document title</Label>
        <input className={inputCls} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <ErrorText error={error} />
      {/* Pinned to the bottom on phones so Attach is always in reach. */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-0 sm:px-0 sm:pt-0 sm:pb-0">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1 sm:flex-none" onClick={save} loading={saving} disabled={!assets}>
          <GalleryHorizontal className="size-4" /> Attach carousel
        </Button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label hint={hint ? `(${hint})` : undefined}>{label}</Label>
      {children}
    </div>
  );
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 md:p-1" disabled={disabled} onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function Items({ label, items, onChange }: { label: string; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div>
      {label && <Label hint="(up to 8)">{label}</Label>}
      <div className="space-y-1.5">
        {items.map((t, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              className={inputCls}
              value={t}
              maxLength={200}
              placeholder={`Point ${i + 1}`}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button className="rounded-lg p-2 text-slate-400 hover:text-red-600 md:p-1" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove point">
              <X className="size-4" />
            </button>
          </div>
        ))}
        {items.length < 8 && (
          <button className="text-xs text-brand-600 hover:underline" onClick={() => onChange([...items, ""])}>
            + Add point
          </button>
        )}
      </div>
    </div>
  );
}
