import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { POSTING_PRESETS, type Post, type PostingPreset, type Slot } from "@postdaily/shared";
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
          <PostRow
            key={p.id}
            post={p}
            meta={`${formatWhen(p.scheduledAt!, tz)}${p.jitterMinutes ? ` ± ${p.jitterMinutes} min` : ""}`}
          >
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

      {!!drafts.data?.length && (
        <Link to="/drafts" className="mt-6 block text-sm text-brand-600 hover:underline">
          You have {drafts.data.length} saved draft{drafts.data.length === 1 ? "" : "s"} →
        </Link>
      )}

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

  // Presets replace all slots and set the weekly goal to match.
  const applyPreset = useMutation({
    mutationFn: async (key: PostingPreset) => {
      const preset = POSTING_PRESETS[key];
      const s = await api.slots.put(preset.slots.map((x) => ({ ...x })));
      await api.settings.update({ weeklyGoal: preset.slots.length });
      return s;
    },
    onSuccess: (s) => {
      setSlots(s);
      qc.setQueryData(["slots"], s);
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
  const matches = (key: PostingPreset) => {
    const want = POSTING_PRESETS[key].slots.map((x) => `${x.dayOfWeek}-${x.time}`).sort().join();
    return slots.map((x) => `${x.dayOfWeek}-${x.time}`).sort().join() === want;
  };

  return (
    <Card>
      <div className="mb-1 text-sm font-medium">Weekly posting times</div>
      <p className="mb-4 text-xs text-slate-500">“Add to queue” puts a post into the next free time below. Set them once.</p>

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {(Object.keys(POSTING_PRESETS) as PostingPreset[]).map((key) => {
          const preset = POSTING_PRESETS[key];
          const active = matches(key);
          return (
            <button
              key={key}
              disabled={active || applyPreset.isPending}
              onClick={() => {
                if (confirm(`Replace your posting times with “${preset.label}” (${preset.description})? Already-queued posts keep their times.`))
                  applyPreset.mutate(key);
              }}
              className={`rounded-lg border p-3 text-left ${active ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {preset.label}
                {key === "twice" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">2/day</span>}
                {active && <Check className="ml-auto size-4 text-brand-600" />}
              </div>
              <div className="text-xs text-slate-500">{preset.description}</div>
            </button>
          );
        })}
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Based on 2026 engagement data: weekday afternoons (3–8 PM) and late mornings get the most engagement. Two posts a day
        should be about 7 hours apart so they don't compete; expect slightly lower reach per post but more total reach.
      </p>
      <ErrorText error={applyPreset.error} />
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
