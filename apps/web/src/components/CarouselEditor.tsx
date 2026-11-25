import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  BarChart3,
  Keyboard,
  ArrowUp,
  ChevronDown,
  Copy,
  GalleryHorizontal,
  ImagePlus,
  Lock,
  LockOpen,
  Palette,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  CAROUSEL_FONTS,
  CAROUSEL_ILLUSTRATIONS,
  CAROUSEL_PATTERNS,
  CAROUSEL_THEMES,
  MAX_CAROUSEL_SLIDES,
  MAX_SLIDE_IMAGES,
  SLIDE_TYPES,
  type CarouselBrand,
  type CarouselDesign,
  type CarouselSlide,
  type SlideType,
} from "@postdaily/shared";
import { api } from "../lib/api";
import { buildCarouselPdf, drawSlide, prepareSlideImage, slideThumbnails, slideTypeOf } from "../lib/carousel";
import { useCarouselAssets } from "../lib/useCarousel";
import { UndoRedo, type HistoryState } from "../lib/carouselHistory";
import { SLIDE_TEMPLATES } from "../lib/carouselTemplates";
import { getCarouselStats, findAndReplace, formatReadingTime } from "../lib/carouselStats";
import { clearDraft, draftDiffers, loadDraft, saveDraft, type CarouselDraft } from "../lib/carouselDraft";
import { Button, ErrorText, Label, Spinner, inputCls } from "./ui";
import { CarouselDesignPanel } from "./CarouselDesignPanel";

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
  draftKey,
  initialTitle,
  initialSlides,
  initialDesign,
  brand,
  name,
  postContent,
  onSave,
  onCancel,
}: {
  /** The post's id: unsaved edits are kept per post in this browser. */
  draftKey: string;
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
  const historyRef = useRef(new UndoRedo());
  const [, setHistoryVersion] = useState(0); // re-render so Undo/Redo buttons track the ref
  const lastTypingPush = useRef(0);
  const lastDesignPush = useRef(0);
  // What the editor opened with, to tell whether there are unsaved edits worth keeping.
  const initial = useRef({ title, slides, design });
  // A draft from an earlier session with this post, offered for restore.
  const [restorable, setRestorable] = useState<CarouselDraft | null>(() => {
    const d = loadDraft(draftKey);
    return d && draftDiffers(d, initial.current) ? d : null;
  });
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Phones: the style controls start folded so the slides are on screen first.
  const [showDesign, setShowDesign] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);
  const [showStats, setShowStats] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [draggedSlide, setDraggedSlide] = useState<number | null>(null);

  // The page behind the designer shouldn't scroll while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Keep unsaved edits for this post (1 s after the last change), so a closed tab doesn't lose work.
  useEffect(() => {
    if (restorable || !draftDiffers({ title, slides, design, savedAt: "" }, initial.current)) return;
    const t = setTimeout(() => saveDraft(draftKey, { title, slides, design }), 1000);
    return () => clearTimeout(t);
  }, [slides, design, title, draftKey, restorable]);

  // Get current slide early for keyboard shortcuts
  const current = slides[Math.min(sel, slides.length - 1)];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Typing in a field keeps the browser's own shortcuts (including undo inside the field).
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || t.isContentEditable)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        stepHistory(e.shiftKey ? "redo" : "undo");
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSel(Math.max(0, sel - 1));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSel(Math.min(slides.length - 1, sel + 1));
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && slides.length > 2 && !current?.locked) {
        e.preventDefault();
        pushHistory();
        setSlides(slides.filter((_, j: number) => j !== sel));
        setSel(Math.max(0, sel - 1));
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (slides.length < MAX_CAROUSEL_SLIDES && (!current.image || imageCount < MAX_SLIDE_IMAGES)) insert({ ...current, locked: false });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setShowFindReplace(true);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const assets = useCarouselAssets(design, brand, name, slides);
  const deferredSlides = useDeferredValue(slides);
  const deferredDesign = useDeferredValue(design);
  const thumbs = useMemo(
    () => (assets ? slideThumbnails(deferredSlides, deferredDesign, assets, 220) : []),
    [deferredSlides, deferredDesign, assets],
  );
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

  const stats = useMemo(() => getCarouselStats(slides), [slides]);

  const pushHistory = () => {
    historyRef.current.push({ slides, design, title });
    setHistoryVersion((v) => v + 1);
  };

  const stepHistory = (dir: "undo" | "redo") => {
    const now = { slides, design, title };
    const state = dir === "undo" ? historyRef.current.undo(now) : historyRef.current.redo(now);
    if (state) {
      setTitle(state.title);
      setSlides(state.slides);
      setDesign(state.design);
      setSel((i) => Math.min(i, state.slides.length - 1));
    }
    setHistoryVersion((v) => v + 1);
  };

  const update = (patch: Partial<CarouselSlide>) => {
    // A locked slide only takes private notes.
    if (current?.locked && Object.keys(patch).some((k) => k !== "notes")) return;
    // Coalesce rapid typing into one undo step.
    const t = Date.now();
    if (t - lastTypingPush.current > 1000) pushHistory();
    lastTypingPush.current = t;
    setSlides(slides.map((s, j) => (j === sel ? { ...s, ...patch } : s)));
  };

  const move = (d: -1 | 1) => {
    if (current?.locked) return;
    pushHistory();
    const next = [...slides];
    [next[sel], next[sel + d]] = [next[sel + d], next[sel]];
    setSlides(next);
    setSel(sel + d);
  };

  const insert = (slide: CarouselSlide) => {
    if (slides.length >= MAX_CAROUSEL_SLIDES) return;
    pushHistory();
    const at = Math.min(sel + 1, slides.length);
    setSlides([...slides.slice(0, at), slide, ...slides.slice(at)]);
    setSel(at);
  };

  const changeType = (type: SlideType) => {
    if (current?.locked) return;
    const b = blank(type);
    update({
      type,
      items: current.items?.length ? current.items : b.items,
      items2: type === "compare" ? (current.items2?.length ? current.items2 : b.items2) : current.items2,
      labels: type === "compare" ? (current.labels ?? b.labels) : current.labels,
      stat: type === "stat" ? (current.stat ?? "") : current.stat,
    });
  };

  const toggleLock = () => {
    pushHistory();
    setSlides(slides.map((s, j) => (j === sel ? { ...s, locked: !s.locked } : s)));
  };

  const applyTemplate = (templateSlides: CarouselSlide[]) => {
    const hasWork = slides.some((s) => s.heading.trim() || s.body.trim() || s.items?.some((i) => i.trim()) || s.image);
    const locked = slides.filter((s) => s.locked).length;
    if (
      hasWork &&
      !confirm(
        `Replace your ${slides.length} slides with this template?${locked ? ` This includes ${locked} locked slide${locked === 1 ? "" : "s"}.` : ""} You can undo it.`,
      )
    )
      return;
    pushHistory();
    setSlides(templateSlides.map((s, i) => ({ ...s, type: slideTypeOf(s, i) })));
    setSel(0);
    setShowTemplates(false);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (slides[index]?.locked) return e.preventDefault();
    setDraggedSlide(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedSlide === null || draggedSlide === targetIndex) {
      setDraggedSlide(null);
      return;
    }
    pushHistory();
    const newSlides = [...slides];
    const [moved] = newSlides.splice(draggedSlide, 1);
    newSlides.splice(targetIndex, 0, moved);
    setSlides(newSlides);
    setSel(targetIndex);
    setDraggedSlide(null);
  };

  const setD = <K extends keyof CarouselDesign>(k: K, v: CarouselDesign[K]) => {
    // Coalesce quick changes (dragging the color picker) into one undo step.
    const t = Date.now();
    if (t - lastDesignPush.current > 800) pushHistory();
    lastDesignPush.current = t;
    setDesign((d) => ({ ...d, [k]: v }));
  };
  const resetDesign = () => {
    pushHistory();
    setDesign(designOf(brand));
  };
  const type = current ? slideTypeOf(current, sel) : "text";
  const overflowCount = thumbs.filter((t) => t.overflow).length;

  const covers = useMutation({ mutationFn: () => api.ai.coverHeadlines(postContent || title, current.heading) });
  // The rewrite applies to the slide it was asked for, even if you select another one meanwhile.
  const rewrite = useMutation({
    mutationFn: (index: number) => api.ai.rewriteSlide(postContent || title, slides[index], instruction || undefined),
    onSuccess: ({ slide }, index) => {
      pushHistory();
      setSlides((all) => all.map((s, j) => (j === index ? slide : s)));
      setInstruction("");
    },
  });
  const runRewrite = () => {
    if (!current?.locked && !rewrite.isPending) rewrite.mutate(sel);
  };
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
      clearDraft(draftKey);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
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
            {design.illustration && design.illustration !== "none" ? ` · ${CAROUSEL_ILLUSTRATIONS[design.illustration]}` : ""}
          </span>
        </span>
        <span className="size-4 rounded-full" style={{ background: design.accent }} />
        <ChevronDown className={`size-4 transition-transform ${showDesign ? "rotate-180" : ""}`} />
      </button>

      {restorable && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="min-w-0 flex-1">
            You have unsaved changes to this carousel from {new Date(restorable.savedAt).toLocaleString()}.
          </span>
          <Button
            variant="secondary"
            className="py-1 text-xs"
            onClick={() => {
              pushHistory();
              setTitle(restorable.title);
              setSlides(restorable.slides);
              setDesign(restorable.design);
              setSel(0);
              setRestorable(null);
            }}
          >
            Restore
          </Button>
          <Button
            variant="ghost"
            className="py-1 text-xs"
            onClick={() => {
              clearDraft(draftKey);
              setRestorable(null);
            }}
          >
            Discard
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          className="py-1.5 text-xs"
          onClick={() => setShowTemplates(!showTemplates)}
        >
          <Plus className="size-3.5" /> Template
        </Button>
        <Button
          variant="ghost"
          className="py-1.5 text-xs"
          onClick={() => setShowFindReplace(!showFindReplace)}
        >
          <Search className="size-3.5" /> Find &amp; replace
        </Button>
        <Button
          variant="ghost"
          className="py-1.5 text-xs"
          onClick={() => setShowStats(!showStats)}
        >
          <BarChart3 className="size-3.5" /> Stats
        </Button>
        <Button variant="ghost" className="py-1.5 text-xs" onClick={() => setShowShortcuts(!showShortcuts)}>
          <Keyboard className="size-3.5" /> Shortcuts
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" className="py-1.5 text-xs" disabled={!historyRef.current.canUndo()} onClick={() => stepHistory("undo")} title="Undo (Ctrl+Z)">
          Undo
        </Button>
        <Button variant="ghost" className="py-1.5 text-xs" disabled={!historyRef.current.canRedo()} onClick={() => stepHistory("redo")} title="Redo (Ctrl+Shift+Z)">
          Redo
        </Button>
      </div>

      {showShortcuts && (
        <div className="grid gap-x-6 gap-y-1.5 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
          {[
            ["Ctrl/⌘ + Z", "Undo"],
            ["Ctrl/⌘ + Shift + Z", "Redo"],
            ["← / →", "Previous / next slide"],
            ["Ctrl/⌘ + D", "Duplicate slide"],
            ["Delete", "Delete slide"],
            ["Ctrl/⌘ + H", "Find & replace"],
            ["Enter (in the rewrite box)", "Rewrite this slide"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-slate-600">{v}</span>
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-700">{k}</kbd>
            </div>
          ))}
          <p className="text-xs text-slate-500 sm:col-span-2">Shortcuts work when you're not typing in a field.</p>
        </div>
      )}

      {showTemplates && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="font-medium text-sm">Slide templates</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SLIDE_TEMPLATES.map((template) => (
              <button
                key={template.name}
                onClick={() => applyTemplate(template.slides)}
                className="text-left rounded-lg border border-slate-200 p-3 hover:bg-brand-50 hover:border-brand-300 transition"
              >
                <div className="font-medium text-sm">{template.name}</div>
                <div className="text-xs text-slate-500">{template.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {showFindReplace && <FindReplacePanel slides={slides} onReplace={(newSlides) => {
        pushHistory();
        setSlides(newSlides);
        setShowFindReplace(false);
      }} onClose={() => setShowFindReplace(false)} />}

      {showStats && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="font-medium text-sm">Carousel statistics</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total characters" value={stats.totalCharacters.toString()} />
            <Stat label="Total words" value={stats.totalWords.toString()} />
            <Stat label="Avg per slide" value={stats.averageSlideLength.toString()} />
            <Stat label="Reading time" value={formatReadingTime(stats.estimatedReadingTimeSeconds)} />
          </div>
        </div>
      )}

      <div className={showDesign ? "" : "hidden md:block"}>
        <CarouselDesignPanel design={design} set={setD} onReset={resetDesign} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {!assets && <Spinner />}
        {thumbs.map((t, i) => (
          <div
            key={i}
            draggable={!slides[i]?.locked}
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, i)}
            className={`relative shrink-0 rounded-md border-2 transition ${slides[i]?.locked ? "" : "cursor-move"} ${
              draggedSlide === i ? "opacity-50" : ""
            } ${i === sel ? "border-brand-500" : "border-transparent"}`}
          >
            <button
              onClick={() => setSel(i)}
              className="relative block"
              aria-label={`Edit slide ${i + 1}`}
            >
              <img src={t.src} alt="" className="h-32 rounded" />
              {t.overflow && (
                <span className="absolute top-1 right-1 rounded-full bg-amber-500 p-0.5 text-white" title="Text is squeezed on this slide">
                  <AlertTriangle className="size-3" />
                </span>
              )}
              {slides[i]?.locked && (
                <span className="absolute bottom-1 right-1 rounded-full bg-slate-900 p-0.5 text-white" title="Slide is locked">
                  <Lock className="size-3" />
                </span>
              )}
            </button>
          </div>
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
              <select className={`${inputCls} w-auto py-1 text-sm`} value={type} onChange={(e) => changeType(e.target.value as SlideType)} disabled={current?.locked}>
                {Object.entries(SLIDE_TYPES).map(([k, v]) => (
                  <option key={k} value={k} disabled={k === "image" && type !== "image" && imageCount >= MAX_SLIDE_IMAGES}>
                    {v}
                  </option>
                ))}
              </select>
              <span className="flex-1" />
              <IconBtn label={current?.locked ? "Unlock slide" : "Lock slide"} onClick={toggleLock}>
                {current?.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
              </IconBtn>
              <IconBtn label="Move left" disabled={sel === 0 || current?.locked} onClick={() => move(-1)}>
                <ArrowUp className="size-4 -rotate-90" />
              </IconBtn>
              <IconBtn label="Move right" disabled={sel === slides.length - 1 || current?.locked} onClick={() => move(1)}>
                <ArrowDown className="size-4 -rotate-90" />
              </IconBtn>
              <IconBtn
                label="Duplicate"
                disabled={slides.length >= MAX_CAROUSEL_SLIDES || (!!current.image && imageCount >= MAX_SLIDE_IMAGES)}
                onClick={() => insert({ ...current, locked: false })}
              >
                <Copy className="size-4" />
              </IconBtn>
              <IconBtn
                label="Delete slide"
                disabled={slides.length <= 2 || current?.locked}
                onClick={() => {
                  pushHistory();
                  setSlides(slides.filter((_, j) => j !== sel));
                  setSel(Math.max(0, sel - 1));
                }}
              >
                <Trash2 className="size-4" />
              </IconBtn>
            </div>

            {current.locked && (
              <p className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
                <Lock className="size-4" /> This slide is locked. Unlock it to edit; notes stay editable.
              </p>
            )}
            <fieldset disabled={!!current.locked} className="min-w-0 space-y-2.5 disabled:opacity-60">
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
                onKeyDown={(e) => e.key === "Enter" && runRewrite()}
              />
              <Button variant="secondary" loading={rewrite.isPending} onClick={runRewrite}>
                <Wand2 className="size-4" /> Rewrite
              </Button>
            </div>
            <ErrorText error={rewrite.error} />
            </fieldset>

            <div className="border-t border-slate-100 pt-2">
              <Field label="Private notes" hint="never shown on the slide">
                <textarea
                  className={`${inputCls} min-h-10 resize-none`}
                  maxLength={500}
                  placeholder="Source, context, reminders… also used as context when you rewrite this slide"
                  value={current.notes ?? ""}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 pt-3">
        <Label hint="(shown above the carousel on LinkedIn)">Document title</Label>
        <input className={inputCls} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <ErrorText error={error} />
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-0 sm:px-0 sm:pt-0 sm:pb-0">
        <Button
          variant="ghost"
          onClick={() => {
            clearDraft(draftKey);
            onCancel();
          }}
        >
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3 border border-slate-200">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function FindReplacePanel({
  slides,
  onReplace,
  onClose,
}: {
  slides: CarouselSlide[];
  onReplace: (slides: CarouselSlide[]) => void;
  onClose: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);

  const preview = searchTerm ? findAndReplace(slides, searchTerm, replaceTerm, caseSensitive) : slides;
  const changeCount = searchTerm
    ? slides.reduce((count, slide, i) => {
        const original = JSON.stringify(slide);
        const updated = JSON.stringify(preview[i]);
        return original === updated ? count : count + 1;
      }, 0)
    : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Find and replace</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-2">
        <Field label="Find">
          <input
            className={inputCls}
            placeholder="Search term"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </Field>
        <Field label="Replace with">
          <input
            className={inputCls}
            placeholder="Replacement text"
            value={replaceTerm}
            onChange={(e) => setReplaceTerm(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
            className="rounded"
          />
          Case sensitive
        </label>
      </div>
      {searchTerm && (
        <div className="text-xs text-slate-600">
          Will update {changeCount} slide{changeCount === 1 ? "" : "s"}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1 py-2 text-sm"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className="flex-1 py-2 text-sm"
          disabled={!searchTerm}
          onClick={() => {
            onReplace(findAndReplace(slides, searchTerm, replaceTerm, caseSensitive));
          }}
        >
          Replace all
        </Button>
      </div>
    </div>
  );
}
