import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import type { Post, Slot } from "@postdaily/shared";
import { DAY_NAMES, api, formatWhen } from "../lib/api";
import { Button, Card, ErrorText, PageHeader, Spinner, inputBaseCls, inputCls } from "../components/ui";

export function QueuePage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const queued = useQuery({ queryKey: ["posts", "queued"], queryFn: () => api.posts.list("queued") });
  const drafts = useQuery({ queryKey: ["posts", "draft"], queryFn: () => api.posts.list("draft") });
  const failed = useQuery({ queryKey: ["posts", "failed"], queryFn: () => api.posts.list("failed") });
  const published = useQuery({ queryKey: ["posts", "published"], queryFn: () => api.posts.list("published") });
  const tz = settings.data?.timezone;

  const unschedule = useMutation({
    mutationFn: (id: string) => api.posts.unschedule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["posts"] }),
  });

  return (
    <>
      <PageHeader title="Queue" subtitle={tz ? `Times are in ${tz}.` : undefined} />
      <SlotsEditor />

      <Section title="Scheduled" empty="Nothing scheduled. Open a draft and add it to the queue.">
        {queued.isLoading ? <Spinner /> : queued.data?.map((p) => (
          <PostRow key={p.id} post={p} meta={formatWhen(p.scheduledAt!, tz)}>
            <Button variant="ghost" className="py-1 text-xs" onClick={() => unschedule.mutate(p.id)}>
              Unschedule
            </Button>
          </PostRow>
        ))}
      </Section>

      {!!failed.data?.length && (
        <Section title="Failed" empty="">
          {failed.data.map((p) => (
            <PostRow key={p.id} post={p} meta={p.error ?? "Failed"} metaClass="text-red-600" />
          ))}
        </Section>
      )}

      <Section title="Drafts" empty="No drafts.">
        {drafts.data?.map((p) => <PostRow key={p.id} post={p} meta={`Edited ${formatWhen(p.updatedAt, tz)}`} />)}
      </Section>

      <Section title="Published" empty="Nothing published yet.">
        {published.data?.slice(0, 20).map((p) => (
          <PostRow key={p.id} post={p} meta={formatWhen(p.publishedAt!, tz)} metaClass="text-green-700" />
        ))}
      </Section>
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      {has ? <div className="space-y-2">{children}</div> : <p className="text-sm text-slate-400">{empty}</p>}
    </section>
  );
}

function PostRow({ post, meta, metaClass = "text-brand-600", children }: { post: Post; meta: string; metaClass?: string; children?: React.ReactNode }) {
  return (
    <Card className="flex items-start gap-4 p-4">
      <Link to={`/posts/${post.id}`} className="min-w-0 flex-1">
        <div className={`text-xs font-medium ${metaClass}`}>{meta}</div>
        <div className="mt-1 line-clamp-2 text-sm whitespace-pre-wrap text-slate-700">{post.content || <i>Empty draft</i>}</div>
      </Link>
      {children}
    </Card>
  );
}

function SlotsEditor() {
  const qc = useQueryClient();
  const slotsQ = useQuery({ queryKey: ["slots"], queryFn: api.slots.get });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [day, setDay] = useState(1);
  const [time, setTime] = useState("09:00");
  useEffect(() => {
    if (slotsQ.data) setSlots(slotsQ.data);
  }, [slotsQ.data]);

  const save = useMutation({
    mutationFn: (s: Slot[]) => api.slots.put(s),
    onSuccess: (s) => {
      setSlots(s);
      qc.setQueryData(["slots"], s);
    },
  });

  const byDay = (d: number) => slots.filter((s) => s.dayOfWeek === d).sort((a, b) => a.time.localeCompare(b.time));

  return (
    <Card>
      <div className="mb-1 text-sm font-medium">Weekly posting times</div>
      <p className="mb-4 text-xs text-slate-500">“Add to queue” puts a post into the next free time below. Set them once.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <div key={d} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
            <div className="mb-1.5 text-xs font-semibold text-slate-500">{DAY_NAMES[d]}</div>
            <div className="flex flex-wrap gap-1">
              {byDay(d).map((s) => (
                <span key={s.time} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
                  {s.time}
                  <button
                    aria-label={`Remove ${DAY_NAMES[d]} ${s.time}`}
                    onClick={() => save.mutate(slots.filter((x) => !(x.dayOfWeek === d && x.time === s.time)))}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {!byDay(d).length && <span className="text-xs text-slate-300">—</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select className={`${inputBaseCls}`} value={day} onChange={(e) => setDay(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <option key={d} value={d}>
              {DAY_NAMES[d]}
            </option>
          ))}
          <option value={0}>Every day</option>
          <option value={-1}>Weekdays</option>
        </select>
        <input type="time" className={`${inputBaseCls}`} value={time} onChange={(e) => setTime(e.target.value)} />
        <Button
          variant="secondary"
          loading={save.isPending}
          onClick={() => {
            const days = day === 0 ? [1, 2, 3, 4, 5, 6, 7] : day === -1 ? [1, 2, 3, 4, 5] : [day];
            save.mutate([...slots, ...days.map((d) => ({ dayOfWeek: d, time }))]);
          }}
        >
          <Plus className="size-4" /> Add time
        </Button>
      </div>
      <div className="mt-2">
        <ErrorText error={save.error} />
      </div>
    </Card>
  );
}
