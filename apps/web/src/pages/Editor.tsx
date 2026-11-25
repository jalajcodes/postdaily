import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Clock, ImagePlus, MessageSquareText, Quote, Redo2, RotateCcw, Send, Trash2, Undo2, Wand2, X } from "lucide-react";
import { LINKEDIN_MAX_CHARS, REWRITE_ACTIONS, type RewriteAction } from "@postdaily/shared";
import { api, formatWhen } from "../lib/api";
import { LinkedInPreview } from "../components/LinkedInPreview";
import { prepareImage, quoteCard } from "../lib/image";
import { Button, Card, ErrorText, Spinner, inputCls } from "../components/ui";

const QUICK: RewriteAction[] = ["new_hook", "shorter", "longer", "punchier", "casual", "professional", "add_cta", "fix_formatting"];

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

  const queue = useMutation({ mutationFn: async () => (await saveFirst(), api.posts.queue(id!, { jitter })), onSuccess: refresh });
  const schedule = useMutation({
    mutationFn: async () => (await saveFirst(), api.posts.update(id!, { scheduledAt: new Date(when).toISOString(), jitter })),
    onSuccess: refresh,
  });
  const unschedule = useMutation({ mutationFn: () => api.posts.unschedule(id!), onSuccess: refresh });
  const publish = useMutation({ mutationFn: async () => (await saveFirst(), api.posts.publish(id!)), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => api.posts.remove(id!),
    onSuccess: () => {
      refresh();
      navigate("/queue");
    },
  });

  const retry = useMutation({ mutationFn: () => api.posts.retry(id!), onSuccess: refresh });
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

  if (post.isLoading) return <Spinner />;
  if (!post.data) return <ErrorText error={post.error ?? "Post not found"} />;
  const p = post.data;
  const isPublished = p.status === "published";
  const over = content.length > LINKEDIN_MAX_CHARS;
  const busy = rewrite.isPending;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
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
            className="min-h-[420px] w-full resize-y rounded-xl p-5 text-[15px] leading-relaxed outline-none disabled:bg-slate-50"
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
              <ImagePlus className="size-4 text-brand-500" /> Image <span className="font-normal text-slate-400">(optional)</span>
            </div>
            {p.hasImage && image.data ? (
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
              </div>
            )}
            <div className="mt-2">
              <ErrorText error={imageError ?? setImage.error ?? removeImage.error} />
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

      <div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
        <LinkedInPreview
          content={content}
          name={me.data?.name ?? "You"}
          picture={me.data?.picture}
          image={p.hasImage ? image.data?.dataUrl : null}
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
    </div>
  );
}
