import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Sparkles } from "lucide-react";
import type { Draft, PostLength } from "@postdaily/shared";
import { api } from "../lib/api";
import { Button, Card, ErrorText, PageHeader, inputCls } from "../components/ui";

export function WritePage() {
  const navigate = useNavigate();
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

  const generate = useMutation({
    mutationFn: () => api.ai.drafts(input, len),
    onSuccess: (r) => setDrafts(r.drafts),
  });

  const pick = useMutation({
    mutationFn: (content: string) => api.posts.create({ content, ideaId }),
    onSuccess: (p) => navigate(`/posts/${p.id}`),
  });

  return (
    <>
      <PageHeader title="Write" subtitle="Drop in a thought, a story, or a link. Get three drafts in your voice." />
      <Card>
        <textarea
          className={`${inputCls} min-h-36 resize-y text-[15px]`}
          placeholder={"e.g. Shipped a feature in 2 days that we'd planned for 2 weeks. What made the difference was...\n\nor paste a link to an article"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && input.trim()) generate.mutate();
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-sm">
            {(["short", "medium", "long"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLength(l)}
                className={`rounded-md px-3 py-1 capitalize ${len === l ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!input.trim()} loading={pick.isPending} onClick={() => pick.mutate(input)}>
              <FileText className="size-4" /> Write it myself
            </Button>
            <Button onClick={() => generate.mutate()} disabled={!input.trim()} loading={generate.isPending}>
              <Sparkles className="size-4" /> Generate 3 drafts
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <ErrorText error={generate.error ?? pick.error} />
        </div>
      </Card>

      {generate.isPending && (
        <p className="mt-6 text-center text-sm text-slate-500">Writing three takes in your voice… this can take up to a minute.</p>
      )}

      {drafts.length > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {drafts.map((d, i) => (
            <Card key={i} className="flex flex-col">
              <div className="mb-2 text-xs font-semibold tracking-wide text-brand-600 uppercase">{d.angle}</div>
              <div className="flex-1 text-sm leading-relaxed whitespace-pre-wrap text-slate-800">{d.content}</div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-400">{d.content.length} chars</span>
                <Button onClick={() => pick.mutate(d.content)} loading={pick.isPending && pick.variables === d.content}>
                  Use this
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
