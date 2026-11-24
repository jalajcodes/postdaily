import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, Trash2, X } from "lucide-react";
import type { IdeaStatus } from "@postdaily/shared";
import { api } from "../lib/api";
import { Button, Card, ErrorText, PageHeader, Spinner, inputCls } from "../components/ui";

const TABS: { id: IdeaStatus; label: string }[] = [
  { id: "new", label: "Fresh" },
  { id: "used", label: "Used" },
  { id: "dismissed", label: "Dismissed" },
];

export function IdeasPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<IdeaStatus>("new");
  const [text, setText] = useState("");
  const ideas = useQuery({ queryKey: ["ideas", tab], queryFn: () => api.ideas.list(tab) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ideas"] });

  const add = useMutation({
    mutationFn: () => api.ideas.create(text),
    onSuccess: () => {
      setText("");
      invalidate();
    },
  });
  const generate = useMutation({ mutationFn: api.ideas.generate, onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: IdeaStatus }) => api.ideas.update(id, { status }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.ideas.remove(id), onSuccess: invalidate });

  return (
    <>
      <PageHeader
        title="Idea bank"
        subtitle="Fresh AI ideas arrive every morning. Save your own whenever inspiration strikes."
        actions={
          <Button onClick={() => generate.mutate()} loading={generate.isPending}>
            <Sparkles className="size-4" /> Suggest 5 ideas
          </Button>
        }
      />
      <ErrorText error={generate.error} />

      <Card className="mb-6">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate();
          }}
        >
          <input className={inputCls} placeholder="Jot down an idea…" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={!text.trim()} loading={add.isPending}>
            <Plus className="size-4" /> Save
          </Button>
        </form>
      </Card>

      <div className="mb-4 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ideas.isLoading ? (
        <Spinner />
      ) : ideas.data?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {ideas.data.map((i) => (
            <Card key={i.id} className="flex flex-col p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
                <span className={`rounded-full px-2 py-0.5 ${i.source === "ai" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                  {i.source === "ai" ? "AI" : "Mine"}
                </span>
                {i.forDate && <span>{i.forDate}</span>}
              </div>
              <p className="flex-1 text-sm text-slate-800">{i.text}</p>
              <div className="mt-3 flex justify-end gap-1">
                {tab === "new" ? (
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => update.mutate({ id: i.id, status: "dismissed" })}>
                    <X className="size-3.5" /> Dismiss
                  </Button>
                ) : (
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => update.mutate({ id: i.id, status: "new" })}>
                    Restore
                  </Button>
                )}
                <Button variant="danger" className="py-1 text-xs" onClick={() => remove.mutate(i.id)} aria-label="Delete idea">
                  <Trash2 className="size-3.5" />
                </Button>
                <Button className="py-1 text-xs" onClick={() => navigate(`/write?idea=${i.id}`)}>
                  Write this
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-slate-500">
          {tab === "new" ? "No fresh ideas. Click “Suggest 5 ideas” or save your own." : "Nothing here yet."}
        </p>
      )}
    </>
  );
}
