// "AI image": the AI describes a picture for the post (or you describe one), FLUX draws it on
// Cloudflare Workers AI, and you can use it as the post's image. Alt text = the description.
// Two models: "Better" (FLUX.2 klein) and "Fast" (FLUX.1 schnell); the choice is remembered.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles, X } from "lucide-react";
import type { ImageStyle } from "@postdaily/shared";
import { api } from "../lib/api";
import { ModelPicker, StylePicker, toUploadable, useImageModel } from "./ImageControls";
import { ThinkingNote } from "./Thinking";
import { Button, ErrorText, inputCls } from "./ui";

export { useAiImageAvailable } from "./ImageControls";

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
  const [model, setModel] = useImageModel();
  const qc = useQueryClient();
  const [description, setDescription] = useState("");
  const [prepError, setPrepError] = useState<unknown>(null);
  const gen = useMutation({
    mutationFn: () => api.ai.image({ content, prompt: description.trim() || undefined, style, model }),
    onSuccess: (r) => {
      setDescription(r.prompt);
      qc.invalidateQueries({ queryKey: ["images"] }); // it's also saved to your library
    },
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
      <ModelPicker model={model} onChange={setModel} />
      <StylePicker style={style} onChange={setStyle} />
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
            <span className="text-xs text-slate-500">Saved to Images too. Edit the description above to change it, then make another.</span>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">Made with FLUX on Cloudflare Workers AI (about 100 free images a day with either model). AI images can get details wrong; check before posting.</p>
      <ErrorText error={gen.error ?? prepError} />
    </div>
  );
}
