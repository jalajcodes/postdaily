// "From library" in the post editor: pick one of your saved images to attach to the post.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ImageIcon, X } from "lucide-react";
import type { LibraryImage } from "@postdaily/shared";
import { api } from "../lib/api";
import { toUploadable, useLibraryImage } from "./ImageControls";
import { ErrorText, Spinner } from "./ui";

function Option({ img, onPick, busy }: { img: LibraryImage; onPick: (src: string) => void; busy: boolean }) {
  const { ref, src } = useLibraryImage(img.id);
  return (
    <div ref={ref}>
      <button
        disabled={!src || busy}
        onClick={() => src && onPick(src)}
        title={img.prompt}
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border-2 border-transparent bg-slate-100 hover:border-brand-500 disabled:cursor-wait"
      >
        {src ? <img src={src} alt={img.prompt} className="size-full object-cover" /> : <ImageIcon className="size-5 text-slate-300" />}
      </button>
    </div>
  );
}

export function LibraryPicker({ onUse, onClose }: { onUse: (dataUrl: string, alt: string) => Promise<unknown>; onClose: () => void }) {
  const library = useQuery({ queryKey: ["images"], queryFn: api.images.list });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (img: LibraryImage, src: string) => {
    setBusy(true);
    setError(null);
    try {
      await onUse(await toUploadable(src), img.prompt.slice(0, 1000));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-slate-900/50 sm:p-6" role="dialog" aria-modal="true" aria-label="Choose an image">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative mx-auto max-w-3xl bg-white p-4 pt-[calc(1rem+env(safe-area-inset-top))] shadow-xl sm:rounded-xl sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Choose from your images</h2>
          <button className="text-slate-400 hover:text-slate-800" aria-label="Close" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        {library.isLoading ? (
          <Spinner />
        ) : !library.data?.length ? (
          <p className="text-sm text-slate-500">
            No saved images yet.{" "}
            <Link to="/images" className="text-brand-600 hover:underline">
              Make some in Images
            </Link>
            .
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {library.data.map((img) => (
              <Option key={img.id} img={img} busy={busy} onPick={(src) => pick(img, src)} />
            ))}
          </div>
        )}
        {busy && <p className="mt-3 text-sm text-slate-500">Attaching…</p>}
        <ErrorText error={error ?? library.error} />
      </div>
    </div>
  );
}
