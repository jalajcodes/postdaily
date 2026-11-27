// Images: make AI images on their own and keep them in a library, to attach to posts later.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, FilePlus2, ImageIcon, Paperclip, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { IMAGE_MODELS, IMAGE_STYLES, MAX_LIBRARY_IMAGES, type ImageStyle, type LibraryImage } from "@postdaily/shared";
import { api } from "../lib/api";
import { ThinkingNote } from "../components/Thinking";
import { ModelPicker, StylePicker, toUploadable, useAiImageAvailable, useImageModel, useLibraryImage } from "../components/ImageControls";
import { Button, Card, ErrorText, PageHeader, Spinner, inputCls } from "../components/ui";

export function ImagesPage() {
  const library = useQuery({ queryKey: ["images"], queryFn: api.images.list });
  const [open, setOpen] = useState<LibraryImage | null>(null);
  const [reuse, setReuse] = useState<LibraryImage | null>(null);
  const count = library.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Images"
        subtitle={`Make images with AI and keep them for your posts. ${count} of ${MAX_LIBRARY_IMAGES} saved.`}
      />
      <Generator reuse={reuse} onMade={setOpen} full={count >= MAX_LIBRARY_IMAGES} />

      <h2 className="mt-8 mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Your library</h2>
      {library.isLoading ? (
        <Spinner />
      ) : !count ? (
        <p className="text-sm text-slate-400">No images yet. Images you make here or in the post editor are kept here.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {library.data!.map((img) => (
            <Thumb key={img.id} img={img} onOpen={() => setOpen(img)} />
          ))}
        </div>
      )}
      <ErrorText error={library.error} />

      {open && (
        <Viewer
          img={open}
          onClose={() => setOpen(null)}
          onReuse={() => {
            setReuse({ ...open });
            setOpen(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </>
  );
}

function Generator({ reuse, onMade, full }: { reuse: LibraryImage | null; onMade: (img: LibraryImage) => void; full: boolean }) {
  const qc = useQueryClient();
  const available = useAiImageAvailable();
  const [model, setModel] = useImageModel();
  const [style, setStyle] = useState<ImageStyle>("photo");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (!reuse) return;
    setDescription(reuse.prompt);
    setStyle(reuse.style);
    setModel(reuse.model);
  }, [reuse]); // eslint-disable-line react-hooks/exhaustive-deps

  const gen = useMutation({
    mutationFn: () => api.ai.image({ prompt: description.trim(), style, model }),
    onSuccess: (r) => {
      qc.setQueryData(["library-image", r.image.id], { dataUrl: r.dataUrl });
      qc.setQueryData<LibraryImage[]>(["images"], (list) => [r.image, ...(list ?? [])]);
      onMade(r.image);
    },
  });

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-brand-500" /> Make an image
      </div>
      {!available ? (
        <p className="text-sm text-slate-500">Making images needs the Cloudflare deployment (it uses Workers AI). Your saved images are below.</p>
      ) : (
        <>
          <ModelPicker model={model} onChange={setModel} />
          <StylePicker style={style} onChange={setStyle} />
          <textarea
            className={`${inputCls} min-h-20 text-sm`}
            maxLength={800}
            placeholder="Describe the image: subject, setting, mood, colors. For example: a small team around a whiteboard sketching a rocket, morning light."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && description.trim() && !gen.isPending) gen.mutate();
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button loading={gen.isPending} disabled={!description.trim() || full} onClick={() => gen.mutate()}>
              {gen.data ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />} {gen.data ? "Make another" : "Make image"}
            </Button>
            {full && <span className="text-xs text-amber-700">Your library is full. Delete some images first.</span>}
          </div>
          {gen.isPending && <ThinkingNote label="Drawing your image…" />}
          <p className="text-xs text-slate-500">
            Images are saved to your library automatically. About 100 free images a day on Cloudflare. AI images can get details
            wrong; check before posting.
          </p>
        </>
      )}
      <ErrorText error={gen.error} />
    </Card>
  );
}

function Thumb({ img, onOpen }: { img: LibraryImage; onOpen: () => void }) {
  const { ref, src } = useLibraryImage(img.id);
  return (
    <div ref={ref}>
      <button onClick={onOpen} className="group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left hover:border-brand-500">
        <div className="flex aspect-square items-center justify-center bg-slate-100">
          {src ? (
            <img src={src} alt={img.prompt} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : (
            <ImageIcon className="size-6 text-slate-300" />
          )}
        </div>
        <div className="p-2">
          <p className="line-clamp-2 text-xs text-slate-700">{img.prompt}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            {IMAGE_STYLES[img.style] ?? img.style} · {IMAGE_MODELS[img.model]?.label ?? img.model} · {new Date(img.createdAt).toLocaleDateString()}
          </p>
        </div>
      </button>
    </div>
  );
}

function Viewer({ img, onClose, onReuse }: { img: LibraryImage; onClose: () => void; onReuse: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { src } = useLibraryImage(img.id, true);
  const drafts = useQuery({ queryKey: ["posts", "draft"], queryFn: () => api.posts.list("draft") });
  const [draftId, setDraftId] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const attach = useMutation({
    mutationFn: async (target: string | "new") => {
      const dataUrl = await toUploadable(src!);
      const postId = target === "new" ? (await api.posts.create({ content: "" })).id : target;
      await api.posts.setImage(postId, dataUrl, img.prompt.slice(0, 1000));
      return postId;
    },
    onSuccess: (postId) => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.removeQueries({ queryKey: ["post-image", postId] });
      navigate(`/posts/${postId}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.images.remove(img.id),
    onSuccess: () => {
      qc.setQueryData<LibraryImage[]>(["images"], (list) => list?.filter((i) => i.id !== img.id));
      qc.removeQueries({ queryKey: ["library-image", img.id] });
      onClose();
    },
  });
  const target = drafts.data?.find((d) => d.id === draftId);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-slate-900/60 sm:p-6" role="dialog" aria-modal="true" aria-label="Image">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative mx-auto max-w-3xl bg-white p-4 pt-[calc(1rem+env(safe-area-inset-top))] shadow-xl sm:rounded-xl sm:p-5">
        <button className="absolute top-3 right-3 rounded-full bg-white/90 p-1.5 text-slate-500 shadow hover:text-slate-900" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </button>
        <div className="flex aspect-square max-h-[65vh] w-full items-center justify-center rounded-lg bg-slate-100">
          {src ? <img src={src} alt={img.prompt} className="max-h-[65vh] w-full rounded-lg object-contain" /> : <Spinner />}
        </div>
        <p className="mt-3 text-sm text-slate-700">{img.prompt}</p>
        <p className="mt-1 text-xs text-slate-400">
          {IMAGE_STYLES[img.style] ?? img.style} · {IMAGE_MODELS[img.model]?.label ?? img.model} · {new Date(img.createdAt).toLocaleString()} ·{" "}
          {Math.round(img.bytes / 1024)} KB
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!src} loading={attach.isPending && attach.variables === "new"} onClick={() => attach.mutate("new")}>
            <FilePlus2 className="size-4" /> New post with this image
          </Button>
          <a
            href={src}
            download={`postdaily-${img.id.slice(0, 8)}.jpg`}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 md:min-h-0 ${src ? "" : "pointer-events-none opacity-50"}`}
          >
            <Download className="size-4" /> Download
          </a>
          <Button variant="secondary" onClick={onReuse}>
            <RefreshCw className="size-4" /> Make a variation
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard?.writeText(img.prompt).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="size-4" /> {copied ? "Copied" : "Copy description"}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => confirm("Delete this image from your library?") && remove.mutate()}>
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Paperclip className="size-4" /> Attach to a draft
          </div>
          {drafts.data?.length ? (
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
              <select className={`${inputCls} min-w-0 flex-1`} value={draftId} onChange={(e) => setDraftId(e.target.value)} aria-label="Draft">
                <option value="">Pick a draft…</option>
                {drafts.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {(d.content.split("\n")[0] || "Empty draft").slice(0, 70)}
                    {d.hasImage || d.hasDocument ? " (replaces its image)" : ""}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={!draftId || !src}
                loading={attach.isPending && attach.variables === draftId}
                onClick={() =>
                  (!target || !(target.hasImage || target.hasDocument) || confirm("This draft already has an image or carousel. Replace it?")) &&
                  attach.mutate(draftId)
                }
              >
                Attach
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No drafts yet. Use "New post with this image" instead.</p>
          )}
        </div>
        <ErrorText error={attach.error ?? remove.error} />
      </div>
    </div>
  );
}
