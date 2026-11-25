import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, FileText, GalleryHorizontal, Mic, Sparkles, Square } from "lucide-react";
import type { Draft, PostLength } from "@postdaily/shared";
import { api } from "../lib/api";
import { useVoiceNote } from "../lib/useVoiceNote";
import { Button, Card, ErrorText, PageHeader, inputCls } from "../components/ui";

export function WritePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const ideaId = params.get("idea");
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const ideas = useQuery({ queryKey: ["ideas"], queryFn: () => api.ideas.list(), enabled: !!ideaId });
  const [input, setInput] = useState("");
  const [length, setLength] = useState<PostLength | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    const idea = ideas.data?.find((i) => i.id === ideaId);
    if (idea) setInput(idea.text);
  }, [ideas.data, ideaId]);

  const len = length ?? settings.data?.defaultLength ?? "medium";

  // Voice note: text is appended to the input (live as you speak, or after recording).
  const voice = useVoiceNote((text) => setInput((v) => (v && !/\s$/.test(v) ? `${v} ` : v) + text));
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  const generate = useMutation({
    mutationFn: () => api.ai.drafts(input, len),
    onSuccess: (r) => {
      setDrafts(r.drafts);
      setSavedIds({});
    },
  });

  // A carousel straight from the idea: the AI writes a caption + slide outline, then the editor opens it.
  const carousel = useMutation({
    mutationFn: () => api.posts.createCarousel(input, ideaId),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      navigate(`/posts/${p.id}`);
    },
  });

  const pick = useMutation({
    mutationFn: (content: string) => api.posts.create({ content, ideaId }),
    onSuccess: (p) => navigate(`/posts/${p.id}`),
  });

  // Save drafts for later without leaving the page. Maps draft index -> saved post id.
  const [savedIds, setSavedIds] = useState<Record<number, string>>({});
  const saveDraft = useMutation({
    mutationFn: async (indexes: number[]) => {
      const results: [number, string][] = [];
      for (const i of indexes) {
        const p = await api.posts.create({ content: drafts[i].content, ideaId });
        results.push([i, p.id]);
      }
      return results;
    },
    onSuccess: (results) => {
      setSavedIds((s) => ({ ...s, ...Object.fromEntries(results) }));
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
  });
  const unsaved = drafts.map((_, i) => i).filter((i) => !savedIds[i]);

  return (
    <>
      <PageHeader title="Write" subtitle="Drop in a thought, a story, or a link, or just talk. Get three drafts in your voice." />
      <Card>
        <div className="relative">
        <textarea
          className={`${inputCls} min-h-36 resize-y text-[15px]`}
          placeholder={"e.g. Shipped a feature in 2 days that we'd planned for 2 weeks. What made the difference was...\n\nor paste a link to an article"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && input.trim()) generate.mutate();
          }}
        />
          {voice.supported && (
            <button
              type="button"
              onClick={voice.toggle}
              disabled={voice.state === "transcribing"}
              className={`absolute right-2 bottom-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm ${
                voice.state === "listening" || voice.state === "recording"
                  ? "animate-pulse bg-red-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              }`}
              aria-pressed={voice.state === "listening" || voice.state === "recording"}
            >
              {voice.state === "listening" || voice.state === "recording" ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}
              {voice.state === "listening"
                ? "Stop"
                : voice.state === "recording"
                  ? `Stop · ${fmt(voice.seconds)}`
                  : voice.state === "transcribing"
                    ? "Turning it into text…"
                    : "Voice note"}
            </button>
          )}
        </div>
        {voice.notice && <p className="mt-2 text-sm text-slate-600">{voice.notice}</p>}
        {(voice.state === "listening" || voice.interim) && (
          <p className="mt-2 text-sm text-slate-500">
            {voice.interim ? <i>{voice.interim}</i> : "Listening… just ramble. Filler words are fine, the drafts clean them up."}
          </p>
        )}
        {voice.state === "recording" && (
          <p className="mt-2 text-sm text-slate-500">Recording… just ramble, then tap Stop. Filler words are fine, the drafts clean them up.</p>
        )}
        {voice.error && <p className="mt-2 text-sm text-amber-700">{voice.error}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-full rounded-lg border border-slate-200 p-0.5 text-sm sm:w-auto">
            {(["short", "medium", "long"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLength(l)}
                className={`flex-1 rounded-md px-3 py-2 capitalize sm:flex-none sm:py-1 ${len === l ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {/* Phones: Generate full width on top, the two alternatives side by side below. */}
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button className="order-2 sm:order-none" variant="secondary" disabled={!input.trim()} loading={pick.isPending} onClick={() => pick.mutate(input)}>
              <FileText className="size-4" /> Write it myself
            </Button>
            <Button
              className="order-3 sm:order-none"
              variant="secondary"
              disabled={!input.trim() || generate.isPending}
              loading={carousel.isPending}
              onClick={() => carousel.mutate()}
              title="Turn this into a swipeable carousel with a short caption"
            >
              <GalleryHorizontal className="size-4" /> Make a carousel
            </Button>
            <Button className="order-1 col-span-2 sm:order-none" onClick={() => generate.mutate()} disabled={!input.trim()} loading={generate.isPending}>
              <Sparkles className="size-4" /> Generate 3 drafts
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <ErrorText error={generate.error ?? pick.error ?? carousel.error} />
        </div>
      </Card>

      {carousel.isPending && <p className="mt-6 text-center text-sm text-slate-500">Outlining your carousel and writing a caption…</p>}
      {generate.isPending && (
        <p className="mt-6 text-center text-sm text-slate-500">Writing three takes in your voice… this can take up to a minute.</p>
      )}

      {drafts.length > 0 && (
        <>
          <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              {Object.keys(savedIds).length > 0 ? (
                <>
                  {Object.keys(savedIds).length} saved to{" "}
                  <Link to="/drafts" className="text-brand-600 hover:underline">
                    Drafts
                  </Link>
                  .
                </>
              ) : (
                "Pick one to edit now, or save drafts for later."
              )}
            </p>
            <Button
              variant="secondary"
              disabled={!unsaved.length}
              loading={saveDraft.isPending && saveDraft.variables?.length > 1}
              onClick={() => saveDraft.mutate(unsaved)}
            >
              <BookmarkPlus className="size-4" /> {unsaved.length ? `Save all ${unsaved.length} as drafts` : "All saved"}
            </Button>
          </div>
          <ErrorText error={saveDraft.error} />
          <div className="grid gap-4 lg:grid-cols-3">
            {drafts.map((d, i) => (
              <Card key={i} className="flex flex-col">
                <div className="mb-2 text-xs font-semibold tracking-wide text-brand-600 uppercase">{d.angle}</div>
                <div className="flex-1 text-sm leading-relaxed whitespace-pre-wrap text-slate-800">{d.content}</div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-400">{d.content.length} chars</span>
                  <div className="flex gap-2">
                    {savedIds[i] ? (
                      <Button variant="ghost" className="text-green-700" onClick={() => navigate(`/posts/${savedIds[i]}`)}>
                        <Check className="size-4" /> Saved
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={saveDraft.isPending}
                        loading={saveDraft.isPending && saveDraft.variables?.length === 1 && saveDraft.variables[0] === i}
                        onClick={() => saveDraft.mutate([i])}
                      >
                        <BookmarkPlus className="size-4" /> Save draft
                      </Button>
                    )}
                    <Button
                      onClick={() => (savedIds[i] ? navigate(`/posts/${savedIds[i]}`) : pick.mutate(d.content))}
                      loading={pick.isPending && pick.variables === d.content}
                    >
                      Use this
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
