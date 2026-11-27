// Shared pieces for AI images: the model and style pickers, the library image loader, and
// turning a stored image into one that can be attached to a post.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IMAGE_MODELS, IMAGE_STYLES, type ImageModel, type ImageStyle } from "@postdaily/shared";
import { api } from "../lib/api";
import { prepareImage } from "../lib/image";

const MODEL_KEY = "postdaily.imageModel";
function savedModel(): ImageModel {
  try {
    const v = localStorage.getItem(MODEL_KEY);
    return v && v in IMAGE_MODELS ? (v as ImageModel) : "better";
  } catch {
    return "better";
  }
}

/** The image model, remembered between visits. */
export function useImageModel() {
  const [model, setModelState] = useState<ImageModel>(savedModel);
  const setModel = (m: ImageModel) => {
    setModelState(m);
    try {
      localStorage.setItem(MODEL_KEY, m);
    } catch {
      /* private mode */
    }
  };
  return [model, setModel] as const;
}

/** Whether this server can make images (the Cloudflare deployment). */
export function useAiImageAvailable() {
  return useQuery({ queryKey: ["ai-image-available"], queryFn: api.ai.imageAvailable, staleTime: Infinity }).data?.available ?? false;
}

/** Resized and compressed so it fits as a post image. */
export async function toUploadable(dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  return prepareImage(new File([blob], "ai-image", { type: blob.type || "image/jpeg" }));
}

export function ModelPicker({ model, onChange }: { model: ImageModel; onChange: (m: ImageModel) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs" role="group" aria-label="Image model">
        {(Object.entries(IMAGE_MODELS) as [ImageModel, (typeof IMAGE_MODELS)[ImageModel]][]).map(([k, m]) => (
          <button
            key={k}
            aria-pressed={model === k}
            title={m.detail}
            onClick={() => onChange(k)}
            className={`rounded-md px-3 py-1 ${model === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <span className="text-xs text-slate-500">{IMAGE_MODELS[model].detail}</span>
    </div>
  );
}

export function StylePicker({ style, onChange }: { style: ImageStyle; onChange: (s: ImageStyle) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Image style">
      {(Object.entries(IMAGE_STYLES) as [ImageStyle, string][]).map(([k, label]) => (
        <button
          key={k}
          aria-pressed={style === k}
          onClick={() => onChange(k)}
          className={`rounded-full border px-3 py-1 text-xs ${style === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-700 hover:border-brand-500"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** A library image's data, loaded once it scrolls near the screen (`eager` loads right away). */
export function useLibraryImage(id: string, eager = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (visible || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: "300px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  const q = useQuery({ queryKey: ["library-image", id], queryFn: () => api.images.get(id), enabled: visible, staleTime: Infinity });
  return { ref, src: q.data?.dataUrl, error: q.error };
}
