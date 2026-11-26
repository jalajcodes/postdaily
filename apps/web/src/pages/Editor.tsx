import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  Check,
  Hash,
  Clock,
  GalleryHorizontal,
  ImagePlus,
  MessageSquareText,
  Pencil,
  Quote,
  Redo2,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import {
  DEFAULT_CAROUSEL_BRAND,
  LINKEDIN_MAX_CHARS,
  REWRITE_ACTIONS,
  hashtagPlace,
  hashtagsIn,
  replaceHook,
  toggleHashtag,
  type Carousel,
  type CarouselDesign,
  type RewriteAction,
} from "@postdaily/shared";
import { api, formatWhen } from "../lib/api";
import { LinkedInPreview } from "../components/LinkedInPreview";
import { prepareImage, quoteCard } from "../lib/image";
import { slideThumbnails } from "../lib/carousel";
import { useCarouselAssets } from "../lib/useCarousel";
import { celebrate } from "../future/celebrate";
import { ThinkingNote } from "../components/Thinking";
import { CarouselEditor } from "../components/CarouselEditor";
import { Button, Card, ErrorText, Spinner, inputCls } from "../components/ui";

const QUICK: RewriteAction[] = ["shorter", "longer", "punchier", "casual", "professional", "add_cta", "fix_formatting"];

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  queued: "bg-brand-50 text-brand-700",
  publishing: "bg-amber-50 text-amber-700",
  published: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
};

export function EditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const post = useQuery({ queryKey: ["post", id], queryFn: () => api.posts.get(id!) });
  const me = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });

  const [content, setContent] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [when, setWhen] = useState("");
  const [saved, setSaved] = useState(true);
  const [firstComment, setFirstComment] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (post.data && !loaded.current) {
      setContent(post.data.content);
      setFirstComment(post.data.firstComment ?? "");
      setImageAlt(post.data.imageAlt ?? "");
      loaded.current = true;
    }
  }, [post.data]);

  const image = useQuery({
    queryKey: ["post-image", id],
    queryFn: () => api.posts.getImage(id!),
    enabled: !!post.data?.hasImage,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["post", id] });
    qc.invalidateQueries({ queryKey: ["posts"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const save = useMutation({
    mutationFn: (c: string) => api.posts.update(id!, { content: c }),
    onSuccess: () => {
      setSaved(true);
      refresh();
    },
  });

  // Autosave 1s after typing stops.
  useEffect(() => {
    if (!loaded.current || saved || post.data?.status === "published") return;
    const t = setTimeout(() => save.mutate(content), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, saved]);

  const edit = (next: string, record = true) => {
    if (record) {
      setHistory((h) => [...h.slice(-30), content]);
      setFuture([]);
    }
    setContent(next);
    setSaved(false);
  };

  const rewrite = useMutation({
    mutationFn: ({ action, instruction }: { action: RewriteAction; instruction?: string }) =>
      api.ai.rewrite(content, action, instruction),
    onSuccess: (r) => edit(r.content),
  });

  const saveFirst = async () => {
    if (!saved) await save.mutateAsync(content);
    if (firstComment !== (post.data?.firstComment ?? "")) await api.posts.update(id!, { firstComment });
  };
  // Random ±N min buffer: per-post choice, defaulting to the setting (or the queued post's current state).
  const [jitterChoice, setJitterChoice] = useState<boolean | null>(null);
  const jitter =
    jitterChoice ??
    (post.data?.status === "queued" ? post.data.jitterMinutes > 0 : (settings.data?.jitterEnabled ?? true));
  const jitterMinutes = post.data?.jitterMinutes || settings.data?.jitterMinutes || 7;
  const toggleJitter = useMutation({
    mutationFn: (on: boolean) => api.posts.update(id!, { jitter: on }),
    onSuccess: refresh,
  });

  const cheer = () => (celebrate(), refresh());
  const queue = useMutation({ mutationFn: async () => (await saveFirst(), api.posts.queue(id!, { jitter })), onSuccess: cheer });
  const schedule = useMutation({
    mutationFn: async () => (await saveFirst(), api.posts.update(id!, { scheduledAt: new Date(when).toISOString(), jitter })),
    onSuccess: cheer,
  });
  const unschedule = useMutation({ mutationFn: () => api.posts.unschedule(id!), onSuccess: refresh });
  const publish = useMutation({ mutationFn: async () => (await saveFirst(), api.posts.publish(id!)), onSuccess: cheer });
  const remove = useMutation({
    mutationFn: () => api.posts.remove(id!),
    onSuccess: () => {
      refresh();
      navigate("/queue");
    },
  });

  const retry = useMutation({ mutationFn: () => api.posts.retry(id!), onSuccess: cheer });
  const saveComment = useMutation({
    mutationFn: (text: string) => api.posts.update(id!, { firstComment: text }),
    onSuccess: refresh,
  });
  const saveAlt = useMutation({ mutationFn: (alt: string) => api.posts.update(id!, { imageAlt: alt }), onSuccess: refresh });
  const setImage = useMutation({
    mutationFn: async (dataUrl: string) => api.posts.setImage(id!, dataUrl, imageAlt || undefined),
    onSuccess: (_p, dataUrl) => {
      qc.setQueryData(["post-image", id], { dataUrl });
      refresh();
    },
  });
  const removeImage = useMutation({
    mutationFn: () => api.posts.removeImage(id!),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["post-image", id] });
      setImageAlt("");
      refresh();
    },
  });
  const [imageError, setImageError] = useState<unknown>(null);

  // Hook variants: 3 alternative openings; picking one replaces the first paragraph.
  const hooks = useMutation({ mutationFn: () => api.ai.hooks(content) });
  // Hashtag suggestions: tap one to add it to (or take it off) the hashtag line at the end.
  const hashtags = useMutation({ mutationFn: () => api.ai.hashtags(content) });
  const tagCount = hashtagsIn(content).length;

  // Carousel: AI outline -> edit slides -> PDF built in the browser -> attached to the post.
  const [carouselDraft, setCarouselDraft] = useState<(Carousel & { design?: CarouselDesign | null }) | null>(null);
  const outline = useMutation({ mutationFn: () => api.ai.carousel(content), onSuccess: (c) => setCarouselDraft(c) });
  const setDocument = useMutation({
    mutationFn: (doc: Parameters<typeof api.posts.setDocument>[1]) => api.posts.setDocument(id!, doc),
    onSuccess: () => {
      setCarouselDraft(null);
      qc.removeQueries({ queryKey: ["post-image", id] });
      refresh();
    },
  });
  const authorName = me.data?.name ?? "";
  const brand = settings.data?.carouselBrand ?? DEFAULT_CAROUSEL_BRAND;
  const slides = post.data?.carouselSlides;
  const docDesign: CarouselDesign = post.data?.carouselDesign ?? {
    theme: brand.theme,
    pattern: brand.pattern,
    font: brand.font,
    accent: brand.accent,
  };
  const docAssets = useCarouselAssets(docDesign, brand, authorName, post.data?.hasDocument ? (slides ?? []) : []);
  const docThumbs = useMemo(
    () => (slides && post.data?.hasDocument && docAssets ? slideThumbnails(slides, docDesign, docAssets, 360).map((t) => t.src) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slides, post.data?.hasDocument, post.data?.carouselDesign, docAssets],
  );
  // A carousel outline saved with the post (made from Write) but not designed/attached yet: open it.
  const pendingOpened = useRef(false);
  useEffect(() => {
    const d = post.data;
    if (!d || pendingOpened.current || d.hasDocument || !d.carouselSlides?.length || d.status === "published") return;
    pendingOpened.current = true;
    setCarouselDraft({ title: d.documentTitle ?? "Carousel", slides: d.carouselSlides, design: d.carouselDesign });
  }, [post.data]);

  if (post.isLoading) return <Spinner />;
  if (!post.data) return <ErrorText error={post.error ?? "Post not found"} />;
  const p = post.data;
  const isPublished = p.status === "published";
  const over = content.length > LINKEDIN_MAX_CHARS;
  const busy = rewrite.isPending;

  return (
    <div className="grid grid-cols-1 gap-6 pb-16 lg:grid-cols-[minmax(0,1fr)_380px] lg:pb-0">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[p.status]}`}>{p.status}</span>
          {p.status === "queued" && p.scheduledAt && (
            <span className="flex items-center gap-1 text-sm text-slate-600">
              <Clock className="size-3.5" /> {formatWhen(p.scheduledAt, settings.data?.timezone)}
              {p.jitterMinutes > 0 && <span className="text-slate-400">± {p.jitterMinutes} min</span>}
            </span>
          )}
          {isPublished && p.publishedAt && (
            <span className="text-sm text-slate-600">Published {formatWhen(p.publishedAt, settings.data?.timezone)}</span>
          )}
          <span className="ml-auto text-xs text-slate-400">{saved ? "Saved" : save.isPending ? "Saving…" : "Unsaved"}</span>
        </div>

        {p.status === "failed" && p.error && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="min-w-0 flex-1">Publishing failed: {p.error}</span>
            <Button variant="secondary" className="py-1 text-xs" onClick={() => retry.mutate()} loading={retry.isPending}>
              <RotateCcw className="size-3.5" /> Retry now
            </Button>
          </div>
        )}
        <ErrorText error={retry.error} />
        {p.status === "queued" && p.error && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{p.error}</p>
        )}
        {isPublished && p.commentError && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The post is live, but the first comment couldn't be added: {p.commentError}
          </p>
        )}

        <Card className="p-0">
          <textarea
            className="min-h-[300px] w-full resize-y rounded-xl p-4 text-[15px] leading-relaxed outline-none disabled:bg-slate-50 md:min-h-[420px] md:p-5"
            value={content}
            disabled={isPublished || busy}
            onChange={(e) => edit(e.target.value, false)}
            onBlur={() => setHistory((h) => (h[h.length - 1] === content ? h : [...h.slice(-30), content]))}
          />
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs">
            <div className="flex gap-1">
              <button
                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                disabled={!history.length || isPublished}
                onClick={() => {
                  setFuture((f) => [content, ...f]);
                  setContent(history[history.length - 1]);
                  setHistory((h) => h.slice(0, -1));
                  setSaved(false);
                }}
                aria-label="Undo"
              >
                <Undo2 className="size-4" />
              </button>
              <button
                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                disabled={!future.length || isPublished}
                onClick={() => {
                  setHistory((h) => [...h, content]);
                  setContent(future[0]);
                  setFuture((f) => f.slice(1));
                  setSaved(false);
                }}
                aria-label="Redo"
              >
                <Redo2 className="size-4" />
              </button>
            </div>
            <span className={over ? "font-medium text-red-600" : "text-slate-400"}>
              {content.length} / {LINKEDIN_MAX_CHARS}
            </span>
          </div>
        </Card>

        {!isPublished && (
          <Card>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Wand2 className="size-4 text-brand-500" /> Quick fixes
            </div>
            <div className="mb-3 rounded-lg bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <b>Hook</b> <span className="text-slate-500">· the lines people see before "…more"</span>
                </span>
                <Button
                  variant="secondary"
                  className="py-1.5 text-xs"
                  disabled={busy || content.trim().length < 20}
                  loading={hooks.isPending}
                  onClick={() => hooks.mutate()}
                >
                  <Sparkles className="size-3.5" /> {hooks.data ? "3 more hooks" : "Try 3 new hooks"}
                </Button>
              </div>
              {hooks.data && (
                <ul className="mt-2 space-y-1.5">
                  {hooks.data.hooks.map((h) => (
                    <li key={h}>
                      <button
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm whitespace-pre-wrap hover:border-brand-500 hover:bg-brand-50"
                        onClick={() => edit(replaceHook(content, h))}
                        title="Use this hook"
                      >
                        {h}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <ErrorText error={hooks.error} />
            </div>
            <div className="mb-3 rounded-lg bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <b>Hashtags</b>{" "}
                  <span className={tagCount > 5 ? "text-amber-700" : "text-slate-500"}>
                    · {tagCount} in post{tagCount > 5 ? ", 3 to 5 usually works best" : ""}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  className="py-1.5 text-xs"
                  disabled={busy || content.trim().length < 20}
                  loading={hashtags.isPending}
                  onClick={() => hashtags.mutate()}
                >
                  <Hash className="size-3.5" /> {hashtags.data ? "Suggest again" : "Suggest popular hashtags"}
                </Button>
              </div>
              {hashtags.data && (
                <>
                  {(["broad", "niche"] as const).map((kind) => {
                    const list = hashtags.data.hashtags.filter((h) => h.kind === kind);
                    if (!list.length) return null;
                    return (
                      <div key={kind} className="mt-2">
                        <div className="mb-1 text-xs text-slate-500">{kind === "broad" ? "Widely followed" : "Specific to this post"}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map(({ tag }) => {
                            const place = hashtagPlace(content, tag);
                            return (
                              <button
                                key={tag}
                                aria-pressed={!!place}
                                disabled={place === "inline"}
                                title={place === "inline" ? "Already in your text" : place ? "Remove from the post" : "Add to the end of the post"}
                                onClick={() => edit(toggleHashtag(content, tag))}
                                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                                  place
                                    ? "border-brand-500 bg-brand-50 text-brand-700"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-brand-500"
                                } disabled:cursor-default`}
                              >
                                {place && <Check className="size-3" />}
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <p className="mt-2 text-xs text-slate-500">Picked by AI from hashtags popular on LinkedIn. LinkedIn doesn't publish live trends, so treat these as a starting point.</p>
                </>
              )}
              <ErrorText error={hashtags.error} />
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((a) => (
                <Button
                  key={a}
                  variant="secondary"
                  className="py-1.5 text-xs"
                  disabled={busy || !content.trim()}
                  loading={busy && rewrite.variables?.action === a}
                  onClick={() => rewrite.mutate({ action: a })}
                >
                  {REWRITE_ACTIONS[a]}
                </Button>
              ))}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim()) rewrite.mutate({ action: "custom", instruction: custom });
              }}
            >
              <input
                className={inputCls}
                placeholder="Or tell it what to change: “mention our 40% drop in churn”"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={busy || !custom.trim()} loading={busy && rewrite.variables?.action === "custom"}>
                Apply
              </Button>
            </form>
            <div className="mt-3">
              <ErrorText error={rewrite.error} />
            </div>
          </Card>
        )}

        {!isPublished && (
          <Card>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <ImagePlus className="size-4 text-brand-500" /> Image or carousel{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </div>
            {carouselDraft ? (
              <>
                <p className="text-sm text-slate-500">Designing your carousel…</p>
                <div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-slate-900/50 sm:p-6" role="dialog" aria-modal="true" aria-label="Design carousel">
                  <div className="mx-auto min-h-dvh max-w-6xl bg-white px-4 pt-[calc(1rem+env(safe-area-inset-top))] shadow-xl sm:min-h-0 sm:rounded-xl sm:p-6">
                    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                      <GalleryHorizontal className="size-5 text-brand-500" /> Design your carousel
                    </h2>
                  <CarouselEditor
                    key={carouselDraft.title + carouselDraft.slides.length}
                    draftKey={id!}
                    initialTitle={carouselDraft.title}
                    initialSlides={carouselDraft.slides}
                    initialDesign={carouselDraft.design ?? null}
                    brand={brand}
                    name={authorName}
                    postContent={content}
                    onSave={(doc) => setDocument.mutateAsync(doc)}
                    onCancel={() => {
                      // Cancelling a carousel that was never attached discards the saved outline.
                      if (!p.hasDocument && p.carouselSlides) removeImage.mutate();
                      setCarouselDraft(null);
                    }}
                  />
                  </div>
                </div>
              </>
            ) : p.hasDocument && slides ? (
              <div className="space-y-2">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {docThumbs.map((src, i) => (
                    <img key={i} src={src} alt={`Slide ${i + 1}`} className="h-36 shrink-0 rounded-md border border-slate-200" />
                  ))}
                </div>
                <p className="text-sm text-slate-600">
                  <b>{p.documentTitle}</b> · {slides.length} slides (PDF carousel)
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Button
                    variant="secondary"
                    className="py-1.5 text-xs"
                    onClick={() => setCarouselDraft({ title: p.documentTitle ?? "", slides, design: p.carouselDesign })}
                  >
                    <Pencil className="size-3.5" /> Edit carousel
                  </Button>
                  <Button
                    variant="secondary"
                    className="py-1.5 text-xs"
                    disabled={busy || !content.trim()}
                    loading={busy && rewrite.variables?.action === "carousel_caption"}
                    onClick={() => rewrite.mutate({ action: "carousel_caption" })}
                    title="The carousel carries the details; make the post a short teaser that gets people to swipe"
                  >
                    <Wand2 className="size-3.5" /> Rewrite post as a short caption
                  </Button>
                  <Button variant="ghost" className="py-1.5 text-xs" onClick={() => removeImage.mutate()} loading={removeImage.isPending}>
                    Remove
                  </Button>
                </div>
              </div>
            ) : p.hasImage && image.data ? (
              <div className="space-y-3">
                <div className="relative">
                  <img src={image.data.dataUrl} alt={imageAlt} className="max-h-72 w-full rounded-lg border border-slate-200 object-contain" />
                  <button
                    onClick={() => removeImage.mutate()}
                    className="absolute top-2 right-2 rounded-full bg-white/90 p-1 text-slate-600 shadow hover:text-red-600"
                    aria-label="Remove image"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <input
                  className={inputCls}
                  placeholder="Alt text: describe the image for screen readers"
                  value={imageAlt}
                  onChange={(e) => setImageAlt(e.target.value)}
                  onBlur={() => imageAlt !== (p.imageAlt ?? "") && saveAlt.mutate(imageAlt)}
                />
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
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
                      setImage.mutate(await prepareImage(f));
                    } catch (err) {
                      setImageError(err);
                    }
                  }}
                />
                <Button variant="secondary" onClick={() => fileInput.current?.click()} loading={setImage.isPending}>
                  <ImagePlus className="size-4" /> Upload image
                </Button>
                <Button
                  variant="secondary"
                  disabled={!content.trim() || setImage.isPending}
                  onClick={() => setImage.mutate(quoteCard(content, me.data?.name ?? ""))}
                >
                  <Quote className="size-4" /> Make a quote card from the hook
                </Button>
                <Button
                  variant="secondary"
                  disabled={content.trim().length < 50}
                  loading={outline.isPending}
                  onClick={() => outline.mutate()}
                  title="Turn this post into a swipeable PDF carousel"
                >
                  <GalleryHorizontal className="size-4" /> Make a carousel
                </Button>
              </div>
            )}
            {outline.isPending && <ThinkingNote label="Outlining slides from your post…" />}
            <div className="mt-2">
              <ErrorText error={imageError ?? setImage.error ?? removeImage.error ?? outline.error ?? setDocument.error} />
            </div>
          </Card>
        )}

        {(!isPublished || p.firstComment) && (
          <Card>
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <MessageSquareText className="size-4 text-brand-500" /> First comment{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </div>
            <p className="mb-2 text-xs text-slate-500">
              Posted right after your post. Put links here: posts with links in the body usually get less reach.
            </p>
            <textarea
              className={`${inputCls} min-h-20 resize-y`}
              placeholder="e.g. Full write-up here: https://…"
              value={firstComment}
              disabled={isPublished}
              maxLength={1250}
              onChange={(e) => setFirstComment(e.target.value)}
              onBlur={() => firstComment !== (p.firstComment ?? "") && saveComment.mutate(firstComment)}
            />
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>{saveComment.isPending ? "Saving…" : ""}</span>
              <span>{firstComment.length} / 1250</span>
            </div>
            <ErrorText error={saveComment.error} />
          </Card>
        )}
      </div>

      <div id="post-preview" className="scroll-mt-20 space-y-4 lg:sticky lg:top-8 lg:self-start">
        <LinkedInPreview
          content={content}
          name={me.data?.name ?? "You"}
          picture={me.data?.picture}
          image={p.hasImage ? image.data?.dataUrl : null}
          document={p.hasDocument && docThumbs.length ? { title: p.documentTitle ?? "", pages: docThumbs } : null}
          firstComment={firstComment}
        />

        {!isPublished && (
          <Card className="space-y-3">
            {p.status === "queued" ? (
              <Button variant="secondary" className="w-full" onClick={() => unschedule.mutate()} loading={unschedule.isPending}>
                Move back to drafts
              </Button>
            ) : (
              <Button className="w-full" onClick={() => queue.mutate()} loading={queue.isPending} disabled={over || !content.trim()}>
                <CalendarPlus className="size-4" /> Add to queue (next free slot)
              </Button>
            )}
            <div className="flex gap-2">
              <input type="datetime-local" className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)} />
              <Button variant="secondary" disabled={!when || over} onClick={() => schedule.mutate()} loading={schedule.isPending}>
                Schedule
              </Button>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={jitter}
                disabled={toggleJitter.isPending}
                onChange={(e) => {
                  setJitterChoice(e.target.checked);
                  if (p.status === "queued") toggleJitter.mutate(e.target.checked);
                }}
              />
              <span>
                Random ±{jitterMinutes} min buffer
                <span className="block text-xs text-slate-500">
                  Posts go out a few minutes before or after the set time, so they don't look automated.
                </span>
              </span>
            </label>
            <Button
              variant="secondary"
              className="w-full"
              disabled={over || !content.trim() || !me.data?.linkedinConnected}
              title={me.data?.linkedinConnected ? "" : "Connect LinkedIn in Settings"}
              onClick={() => {
                if (confirm("Publish this post to LinkedIn now?")) publish.mutate();
              }}
              loading={publish.isPending}
            >
              <Send className="size-4" /> Post now
            </Button>
            {!me.data?.linkedinConnected && (
              <p className="text-xs text-slate-500">Connect LinkedIn in Settings to publish. You can still queue posts.</p>
            )}
            <ErrorText error={queue.error ?? schedule.error ?? publish.error ?? unschedule.error} />
          </Card>
        )}

        <Button
          variant="danger"
          className="w-full"
          onClick={() => {
            if (confirm("Delete this post?")) remove.mutate();
          }}
        >
          <Trash2 className="size-4" /> Delete
        </Button>
      </div>

      {/* Phones: the main actions stay in reach above the tab bar. */}
      {!isPublished && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="px-2.5"
              onClick={() => document.getElementById("post-preview")?.scrollIntoView({ behavior: "smooth" })}
            >
              Preview
            </Button>
            <span className="flex-1" />
            {p.status === "failed" ? (
              <Button variant="secondary" onClick={() => retry.mutate()} loading={retry.isPending}>
                <RotateCcw className="size-4" /> Retry
              </Button>
            ) : p.status === "queued" ? (
              <Button variant="secondary" onClick={() => unschedule.mutate()} loading={unschedule.isPending}>
                Unschedule
              </Button>
            ) : (
              <Button onClick={() => queue.mutate()} loading={queue.isPending} disabled={over || !content.trim()}>
                <CalendarPlus className="size-4" /> Queue
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={over || !content.trim() || !me.data?.linkedinConnected}
              onClick={() => {
                if (confirm("Publish this post to LinkedIn now?")) publish.mutate();
              }}
              loading={publish.isPending}
              aria-label="Post now"
            >
              <Send className="size-4" /> Post
            </Button>
          </div>
          {(queue.error || publish.error || unschedule.error || retry.error) && (
            <div className="mt-2">
              <ErrorText error={queue.error ?? publish.error ?? unschedule.error ?? retry.error} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
