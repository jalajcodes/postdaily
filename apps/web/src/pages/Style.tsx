import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import type { Profile } from "@postdaily/shared";
import { api } from "../lib/api";
import { Button, Card, ErrorText, Label, PageHeader, SaveBar, Spinner, inputCls } from "../components/ui";

export function StylePage() {
  const qc = useQueryClient();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: api.profile.get });
  const [p, setP] = useState<Profile | null>(null);
  const [topic, setTopic] = useState("");
  const [banned, setBanned] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (profileQ.data) setP(profileQ.data);
  }, [profileQ.data]);

  const onSaved = (data: Profile) => {
    qc.setQueryData(["profile"], data);
    setP(data);
    setDirty(false);
  };
  const save = useMutation({ mutationFn: (x: Profile) => api.profile.update(x), onSuccess: onSaved });
  const clearLearned = useMutation({ mutationFn: api.profile.clearLearned, onSuccess: onSaved });
  const analyze = useMutation({
    mutationFn: async () => {
      await api.profile.update(p!);
      return api.profile.analyze();
    },
    onSuccess: onSaved,
  });

  if (!p) return <Spinner />;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    setP({ ...p, [k]: v });
    setDirty(true);
  };

  return (
    <>
      <PageHeader
        title="My style"
        subtitle="Everything the AI knows about you and how you write. Edit anything."
        actions={
          <Button onClick={() => save.mutate(p)} loading={save.isPending} disabled={!dirty}>
            {dirty ? "Save changes" : "Saved"}
          </Button>
        }
      />
      <ErrorText error={save.error} />
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(p)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <div>
            <Label>What you do</Label>
            <input className={inputCls} placeholder="e.g. Founder of a B2B SaaS for clinics; ex-engineer" value={p.niche} onChange={(e) => set("niche", e.target.value)} />
          </div>
          <div>
            <Label>Who you write for</Label>
            <input className={inputCls} placeholder="e.g. Early-stage founders and product leaders" value={p.audience} onChange={(e) => set("audience", e.target.value)} />
          </div>
          <div>
            <Label>What you want from LinkedIn</Label>
            <input className={inputCls} placeholder="e.g. Inbound leads, hiring, building a personal brand" value={p.goals} onChange={(e) => set("goals", e.target.value)} />
          </div>
          <div>
            <Label>Topics</Label>
            <Chips items={p.topics} onRemove={(t) => set("topics", p.topics.filter((x) => x !== t))} />
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (topic.trim()) set("topics", [...p.topics, topic.trim()]);
                setTopic("");
              }}
            >
              <input className={inputCls} placeholder="Add a topic and press Enter" value={topic} onChange={(e) => setTopic(e.target.value)} />
            </form>
          </div>
          <div>
            <Label hint="(on top of the built-in AI-cliché list)">Never say</Label>
            <Chips items={p.bannedPhrases} onRemove={(t) => set("bannedPhrases", p.bannedPhrases.filter((x) => x !== t))} />
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (banned.trim()) set("bannedPhrases", [...p.bannedPhrases, banned.trim()]);
                setBanned("");
              }}
            >
              <input className={inputCls} placeholder="A word or phrase you hate" value={banned} onChange={(e) => setBanned(e.target.value)} />
            </form>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <Label hint="(3-10 posts, separated by a blank line or ---)">Your past posts</Label>
            <textarea
              className={`${inputCls} min-h-56 resize-y`}
              placeholder="Paste a few LinkedIn posts you've written and liked…"
              value={p.samplePosts}
              onChange={(e) => set("samplePosts", e.target.value)}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">{p.samplePosts.length} chars</span>
              <Button variant="secondary" onClick={() => analyze.mutate()} loading={analyze.isPending} disabled={p.samplePosts.length < 200 && p.learnedCount === 0}>
                <Sparkles className="size-4" /> Learn my style
              </Button>
            </div>
            <div className="mt-2">
              <ErrorText error={analyze.error} />
            </div>
          </div>
          <div>
            <Label hint="(used in every draft)">Style guide</Label>
            <textarea
              className={`${inputCls} min-h-56 resize-y font-mono text-xs leading-relaxed`}
              placeholder={"- Opens with a one-line, specific claim\n- Short paragraphs, lots of white space\n- No emojis, max 2 hashtags\n- Ends with a question"}
              value={p.styleGuide}
              onChange={(e) => set("styleGuide", e.target.value)}
            />
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Learning from what you publish</span>
              {p.learnedCount > 0 && (
                <button
                  className="text-xs text-slate-500 hover:text-red-600"
                  onClick={() => {
                    if (confirm("Forget the published posts PostDaily learned from?")) clearLearned.mutate();
                  }}
                >
                  Reset
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {p.learnedCount > 0
                ? `Your ${p.learnedCount} most recent published post${p.learnedCount === 1 ? " is" : "s are"} used as voice examples in every draft.`
                : "Once you publish, your final posts (after your edits) are used as voice examples in every draft."}{" "}
              Every 5 published posts, the style guide above is re-learned automatically.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

function Chips({ items, onRemove }: { items: string[]; onRemove: (s: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
          {t}
          <button onClick={() => onRemove(t)} className="text-slate-400 hover:text-red-500" aria-label={`Remove ${t}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
