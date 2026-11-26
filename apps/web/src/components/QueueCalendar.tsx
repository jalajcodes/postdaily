// Week calendar of the queue: scheduled, published and failed posts by day, plus your open
// posting slots. Drag a scheduled post to another day (or use "Move" on phones); it keeps its time.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import type { Post } from "@postdaily/shared";
import { api } from "../lib/api";
import { addDays, dayKey, isoWeekday, moveToDay, weekStart, zonedParts, zonedToIso } from "../lib/zoned";
import { Button, ErrorText } from "./ui";

type Item = { post: Post; at: string; kind: "queued" | "published" | "failed" };

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export function QueueCalendar({ queued, published, failed, tz }: { queued: Post[]; published: Post[]; failed: Post[]; tz: string }) {
  const qc = useQueryClient();
  const slots = useQuery({ queryKey: ["slots"], queryFn: api.slots.get });
  const today = dayKey(new Date(), tz);
  const [start, setStart] = useState(() => weekStart(today));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);

  const byDay = useMemo(() => {
    const items: Item[] = [
      ...queued.filter((p) => p.scheduledAt).map((p) => ({ post: p, at: p.scheduledAt!, kind: "queued" as const })),
      ...published.filter((p) => p.publishedAt).map((p) => ({ post: p, at: p.publishedAt!, kind: "published" as const })),
      ...failed.map((p) => ({ post: p, at: p.scheduledAt ?? p.updatedAt ?? p.createdAt, kind: "failed" as const })),
    ];
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const k = dayKey(it.at, tz);
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    for (const list of map.values()) list.sort((a, b) => a.at.localeCompare(b.at));
    return map;
  }, [queued, published, failed, tz]);

  const move = useMutation({
    mutationFn: ({ post, day }: { post: Post; day: string }) =>
      api.posts.update(post.id, { scheduledAt: moveToDay(post.scheduledAt!, day, tz), jitter: post.jitterMinutes > 0 }),
    onSuccess: () => {
      setMoving(null);
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
  });

  const dropTo = (day: string) => {
    const post = queued.find((p) => p.id === dragging);
    setDragging(null);
    setOver(null);
    if (post && dayKey(post.scheduledAt!, tz) !== day) move.mutate({ post, day });
  };

  const label = (day: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="px-2" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium">
            {label(days[0], { month: "short", day: "numeric" })} – {label(days[6], { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <Button variant="ghost" className="px-2" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {start !== weekStart(today) && (
          <Button variant="secondary" className="py-1 text-xs" onClick={() => setStart(weekStart(today))}>
            <CalendarDays className="size-3.5" /> This week
          </Button>
        )}
      </div>
      <ErrorText error={move.error} />

      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const past = day < today;
          const taken = new Set(items.map((i) => { const p = zonedParts(i.at, tz); return hhmm(p.h, p.min); }));
          const now = new Date().toISOString();
          const open = past
            ? []
            : (slots.data ?? [])
                .filter((s) => s.dayOfWeek === isoWeekday(day) && !taken.has(s.time))
                .filter((s) => zonedToIso(day, +s.time.slice(0, 2), +s.time.slice(3), tz) > now)
                .map((s) => s.time)
                .sort();
          const canDrop = !!dragging && !past;
          return (
            <div
              key={day}
              onDragOver={(e) => {
                if (!canDrop) return;
                e.preventDefault();
                setOver(day);
              }}
              onDragLeave={() => setOver((o) => (o === day ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (canDrop) dropTo(day);
              }}
              className={`rounded-lg border p-2 transition-colors md:min-h-56 ${
                over === day ? "border-brand-500 bg-brand-50" : day === today ? "border-brand-200 bg-white" : "border-slate-200 bg-white"
              } ${past ? "opacity-70" : ""}`}
            >
              <div className={`mb-2 flex items-baseline gap-1.5 text-xs ${day === today ? "font-semibold text-brand-600" : "text-slate-500"}`}>
                <span className="uppercase">{label(day, { weekday: "short" })}</span>
                <span className="text-base text-slate-900">{label(day, { day: "numeric" })}</span>
                {day === today && <span>· Today</span>}
              </div>
              <div className="space-y-1.5">
                {items.map(({ post, at, kind }) => {
                  const p = zonedParts(at, tz);
                  const color =
                    kind === "published" ? "border-l-green-500" : kind === "failed" ? "border-l-red-500" : "border-l-brand-500";
                  return (
                    <div
                      key={post.id}
                      draggable={kind === "queued"}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", post.id);
                        setDragging(post.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      className={`group rounded-md border border-l-4 border-slate-200 bg-white p-1.5 text-xs shadow-sm ${color} ${
                        kind === "queued" ? "cursor-grab active:cursor-grabbing" : ""
                      } ${dragging === post.id ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-slate-600">
                          {hhmm(p.h, p.min)}
                          {kind === "published" ? " · Posted" : kind === "failed" ? " · Failed" : ""}
                        </span>
                        {kind === "queued" && <GripVertical className="hidden size-3 text-slate-300 md:block" />}
                      </div>
                      <Link to={`/posts/${post.id}`} className="mt-0.5 line-clamp-2 text-slate-700 hover:text-brand-600">
                        {post.content || <i>Empty draft</i>}
                      </Link>
                      {kind === "queued" &&
                        (moving === post.id ? (
                          <input
                            type="date"
                            autoFocus
                            min={today}
                            defaultValue={day}
                            aria-label="Move to day"
                            className="mt-1 w-full rounded border border-slate-200 px-1 py-0.5 text-xs"
                            onChange={(e) => e.target.value && e.target.value !== day && move.mutate({ post, day: e.target.value })}
                            onBlur={() => setMoving(null)}
                          />
                        ) : (
                          <button
                            className="mt-1 text-[11px] text-brand-600 hover:underline md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                            onClick={() => setMoving(post.id)}
                            disabled={move.isPending}
                          >
                            {move.isPending && move.variables?.post.id === post.id ? "Moving…" : "Move"}
                          </button>
                        ))}
                    </div>
                  );
                })}
                {open.map((time) => (
                  <Link
                    key={time}
                    to="/drafts"
                    title="Open slot: queue a draft into it"
                    className="block rounded-md border border-dashed border-slate-300 px-1.5 py-1 text-[11px] text-slate-400 hover:border-brand-500 hover:text-brand-600"
                  >
                    {time} · open slot
                  </Link>
                ))}
                {!items.length && !open.length && <p className="text-[11px] text-slate-300 md:pt-2">—</p>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Drag a scheduled post to another day (or tap Move); it keeps its time. Times are in {tz}.
      </p>
    </div>
  );
}
