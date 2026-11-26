// "AI image": the AI describes a picture for the post (or you describe one), FLUX draws it on
// Cloudflare Workers AI, and you can use it as the post's image. Alt text = the description.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { IMAGE_STYLES, type ImageStyle } from "@postdaily/shared";
import { api } from "../lib/api";
import { prepareImage } from "../lib/image";
import { ThinkingNote } from "./Thinking";
import { Button, ErrorText, inputCls } from "./ui";

async function toUploadable(dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  return prepareImage(new File([blob], "ai-image", { type: blob.type || "image/jpeg" }));
}

/** The "AI image" button; opens the panel when clicked. Hidden where image generation isn't available. */
export function useAiImageAvailable() {
  return useQuery({ queryKey: ["ai-image-available"], queryFn: api.ai.imageAvailable, staleTime: Infinity }).data?.available ?? false;
}

export function AiImagePanel({
  content,
  onUse,
  onClose,
  saving,
}: {
  content: string;
  onUse: (dataUrl: string, alt: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [style, setStyle] = useState<ImageStyle>("photo");
  const [description, setDescription] = useState("");
  const [prepError, setPrepError] = useState<unknown>(null);
  const gen = useMutation({
    mutationFn: () => api.ai.image({ content, prompt: description.trim() || undefined, style }),
    onSuccess: (r) => setDescription(r.prompt),
  });

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-brand-500" /> AI image
        </div>
        <button className="text-slate-400 hover:text-slate-700" aria-label="Close AI image" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(Object.entries(IMAGE_STYLES) as [ImageStyle, string][]).map(([k, label]) => (
          <button
            key={k}
            aria-pressed={style === k}
            onClick={() => setStyle(k)}
            className={`rounded-full border px-3 py-1 text-xs ${style === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-700 hover:border-brand-500"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        className={`${inputCls} min-h-16 text-sm`}
        maxLength={800}
        placeholder="Describe the image, or leave empty and the AI will come up with one from your post."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={gen.isPending}
          disabled={!description.trim() && content.trim().length < 20}
          onClick={() => gen.mutate()}
        >
          {gen.data ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />} {gen.data ? "Make another" : "Make image"}
        </Button>
      </div>
      {gen.isPending && <ThinkingNote label={description.trim() ? "Drawing your image…" : "Picturing your post, then drawing it…"} />}
      {gen.data && !gen.isPending && (
        <div className="space-y-2">
          <img src={gen.data.dataUrl} alt={gen.data.prompt} className="max-h-80 w-full rounded-lg border border-slate-200 object-contain" />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              loading={saving}
              onClick={async () => {
                setPrepError(null);
                try {
                  onUse(await toUploadable(gen.data.dataUrl), gen.data.prompt.slice(0, 1000));
                } catch (e) {
                  setPrepError(e);
                }
              }}
            >
              Use this image
            </Button>
            <span className="text-xs text-slate-500">Edit the description above to change it, then make another.</span>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">Made with FLUX on Cloudflare Workers AI. AI images can get details wrong; check before posting.</p>
      <ErrorText error={gen.error ?? prepError} />
    </div>
  );
}
