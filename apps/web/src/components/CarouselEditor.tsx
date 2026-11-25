import { useDeferredValue, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GalleryHorizontal, Plus, Trash2 } from "lucide-react";
import type { CarouselSlide } from "@postdaily/shared";
import { buildCarouselPdf, slideThumbnails } from "../lib/image";
import { Button, ErrorText, inputCls } from "./ui";

const MAX_SLIDES = 12;

/** Edit a carousel's slides with a live preview, then build the PDF and hand it back. */
export function CarouselEditor({
  initialTitle,
  initialSlides,
  name,
  onSave,
  onCancel,
}: {
  initialTitle: string;
  initialSlides: CarouselSlide[];
  name: string;
  onSave: (doc: { dataUrl: string; title: string; slides: CarouselSlide[] }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [slides, setSlides] = useState(initialSlides);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const deferred = useDeferredValue(slides);
  const thumbs = useMemo(() => slideThumbnails(deferred, name, 240), [deferred, name]);

  const update = (i: number, patch: Partial<CarouselSlide>) => setSlides(slides.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...slides];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setSlides(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const clean = slides.map((s) => ({ heading: s.heading.trim(), body: s.body.trim() })).filter((s) => s.heading || s.body);
      if (clean.length < 2) throw new Error("A carousel needs at least 2 slides");
      const dataUrl = await buildCarouselPdf(clean, title.trim() || "Carousel", name);
      await onSave({ dataUrl, title: title.trim() || "Carousel", slides: clean });
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {thumbs.map((src, i) => (
          <img key={i} src={src} alt={`Slide ${i + 1}`} className="h-40 shrink-0 rounded-md border border-slate-200" />
        ))}
      </div>
      <input
        className={inputCls}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Document title (shown on LinkedIn above the carousel)"
      />
      <ol className="space-y-2">
        {slides.map((s, i) => (
          <li key={i} className="rounded-lg border border-slate-200 p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
              <span>{i === 0 ? "Cover" : i === slides.length - 1 ? "Last slide" : `Slide ${i + 1}`}</span>
              <span className="flex gap-1">
                <button className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30"
                  disabled={i === slides.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  className="rounded p-0.5 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
                  disabled={slides.length <= 2}
                  onClick={() => setSlides(slides.filter((_, j) => j !== i))}
                  aria-label="Remove slide"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </div>
            <input
              className={`${inputCls} mb-1.5 font-medium`}
              value={s.heading}
              maxLength={120}
              placeholder="Heading"
              onChange={(e) => update(i, { heading: e.target.value })}
            />
            <textarea
              className={`${inputCls} min-h-14 resize-y`}
              value={s.body}
              maxLength={400}
              placeholder="Body (optional)"
              onChange={(e) => update(i, { body: e.target.value })}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={slides.length >= MAX_SLIDES}
          onClick={() => setSlides([...slides.slice(0, -1), { heading: "", body: "" }, ...slides.slice(-1)])}
        >
          <Plus className="size-4" /> Add slide
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving}>
          <GalleryHorizontal className="size-4" /> Attach carousel
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}
