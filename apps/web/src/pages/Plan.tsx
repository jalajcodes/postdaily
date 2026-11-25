import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarRange, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { PlannedPost } from "@postdaily/shared";
import { api, formatWhen } from "../lib/api";
import { Button, Card, ErrorText, Label, PageHeader, Spinner, inputCls } from "../components/ui";

const PILLAR_EXAMPLES = ["Lessons from building my product", "Hiring and team", "Behind the scenes", "Opinions on my industry"];

export function PlanPage() {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile.get });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const slots = useQuery({ queryKey: ["plan-slots"], queryFn: () => api.plan.slots(7) });
  const [newPillar, setNewPillar] = useState("");
  const [items, setItems] = useState<PlannedPost[]>([]);
  const [missing, setMissing] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set());
  const tz = settings.data?.timezone;

  const savePillars = useMutation({
    mutationFn: (pillars: string[]) => api.profile.update({ pillars }),
    onSuccess: (p) => qc.setQueryData(["profile"], p),
  });
  // A second run only fills slots not already covered by the drafts on screen.
  const covered = items.filter((i) => !scheduledIds.has(i.post.id)).map((i) => i.slot);
  const generate = useMutation({
    mutationFn: () => api.plan.week(7, covered),
    onSuccess: (r) => {
      const keep = items.filter((i) => !scheduledIds.has(i.post.id));
      const next = [...keep, ...r.items].sort((a, b) => a.slot.localeCompare(b.slot));
      setItems(next);
      setMissing(r.missing);
      setSelected(new Set([...selected, ...r.items.map((i) => i.post.id)]));
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
  });
  const schedule = useMutation({
    mutationFn: () =>
      api.plan.schedule(items.filter((i) => selected.has(i.post.id)).map((i) => ({ postId: i.post.id, scheduledAt: i.slot }))),
    onSuccess: (r) => {
      setScheduledIds(new Set([...scheduledIds, ...r.posts.map((p) => p.id)]));
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["plan-slots"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.posts.remove(id),
    onSuccess: (_r, id) => {
      setItems(items.filter((i) => i.post.id !== id));
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
  });

  if (!profile.data) return <Spinner />;
  const pillars = profile.data.pillars;
  const usable = pillars.length ? pillars : profile.data.topics;
  const freeCount = (slots.data?.slots ?? []).filter((s) => !covered.includes(s)).length;
  const addPillar = (p: string) => {
    const v = p.trim();
    if (v && !pillars.includes(v) && pillars.length < 8) savePillars.mutate([...pillars, v]);
  };
  const toSchedule = items.filter((i) => selected.has(i.post.id) && !scheduledIds.has(i.post.id));

  return (
    <>
      <PageHeader title="Plan my week" subtitle="One click: a draft for every free posting slot this week, rotating through your themes." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <div>
            <Label hint="(2-5 recurring themes you post about)">Content pillars</Label>
            {pillars.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {pillars.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
                    {p}
                    <button
                      onClick={() => savePillars.mutate(pillars.filter((x) => x !== p))}
                      className="text-brand-400 hover:text-red-500"
                      aria-label={`Remove ${p}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                {profile.data.topics.length
                  ? `No pillars yet, so your topics (${profile.data.topics.join(", ")}) are used.`
                  : "Add a few themes so the week has variety."}
              </p>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addPillar(newPillar);
              setNewPillar("");
            }}
          >
            <input
              className={inputCls}
              placeholder="e.g. Lessons from scaling to 100 customers"
              value={newPillar}
              maxLength={120}
              onChange={(e) => setNewPillar(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!newPillar.trim() || pillars.length >= 8}>
              Add
            </Button>
          </form>
          {pillars.length === 0 && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="text-slate-400">Ideas:</span>
              {PILLAR_EXAMPLES.map((ex) => (
                <button key={ex} className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50" onClick={() => addPillar(ex)}>
                  + {ex}
                </button>
              ))}
            </div>
          )}
          <ErrorText error={savePillars.error} />
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarRange className="size-4 text-brand-500" /> Next 7 days
          </div>
          {slots.isLoading ? (
            <Spinner />
          ) : freeCount ? (
            <p className="text-sm text-slate-600">
              {freeCount} free slot{freeCount === 1 ? "" : "s"}
              {covered.length ? " without a draft" : `, starting ${formatWhen(slots.data!.slots[0], tz)}`}.
              {freeCount === 10 && " (Plans are capped at 10 posts.)"}
            </p>
          ) : covered.length ? (
            <p className="text-sm text-slate-600">Every free slot this week has a draft below.</p>
          ) : (
            <p className="text-sm text-slate-600">
              Every slot this week already has a post. Add posting times in the{" "}
              <Link to="/queue" className="text-brand-600 hover:underline">
                Queue
              </Link>
              .
            </p>
          )}
          <Button className="w-full" onClick={() => generate.mutate()} loading={generate.isPending} disabled={!freeCount || !usable.length}>
            <Sparkles className="size-4" /> Write {freeCount || ""} post{freeCount === 1 ? "" : "s"}
          </Button>
          {generate.isPending && (
            <p className="text-center text-xs text-slate-500">Writing {freeCount} posts in your voice… this can take a minute or two.</p>
          )}
          <p className="text-xs text-slate-500">
            Posts are saved as drafts. Nothing is scheduled until you review them and click Schedule.
          </p>
          <ErrorText error={generate.error} />
        </Card>
      </div>

      {items.length > 0 && (
        <>
          <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              {scheduledIds.size > 0 ? (
                <>
                  {scheduledIds.size} scheduled.{" "}
                  <Link to="/queue" className="text-brand-600 hover:underline">
                    See the queue
                  </Link>
                </>
              ) : (
                "Review, edit or remove, then schedule. Unscheduled ones stay in Drafts."
              )}
              {missing > 0 && ` ${missing} couldn't be written (the AI was busy). Click Write again to fill just those.`}
            </p>
            <Button onClick={() => schedule.mutate()} loading={schedule.isPending} disabled={!toSchedule.length}>
              <CalendarCheck className="size-4" /> Schedule {toSchedule.length || ""} selected
            </Button>
          </div>
          <ErrorText error={schedule.error ?? remove.error} />
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((it) => {
              const done = scheduledIds.has(it.post.id);
              return (
                <Card key={it.post.id} className={`flex flex-col ${done ? "opacity-70" : ""}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    {!done && (
                      <input
                        type="checkbox"
                        checked={selected.has(it.post.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          e.target.checked ? next.add(it.post.id) : next.delete(it.post.id);
                          setSelected(next);
                        }}
                        aria-label="Include when scheduling"
                      />
                    )}
                    <span className="font-medium text-brand-700">{formatWhen(it.slot, tz)}</span>
                    <span className="truncate rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{it.pillar}</span>
                    {done && <span className="ml-auto font-medium text-green-700">Scheduled</span>}
                  </div>
                  <div className="line-clamp-[8] flex-1 text-sm whitespace-pre-wrap text-slate-800">{it.post.content}</div>
                  <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-2">
                    <Link to={`/posts/${it.post.id}`} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                      <Pencil className="size-3.5" /> Edit
                    </Link>
                    {!done && (
                      <button
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove.mutate(it.post.id)}
                      >
                        <Trash2 className="size-3.5" /> Remove
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
