import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, PenLine, Search, Trash2 } from "lucide-react";
import { api, formatWhen } from "../lib/api";
import { Button, Card, ErrorText, PageHeader, Spinner, inputCls } from "../components/ui";

export function DraftsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const drafts = useQuery({ queryKey: ["posts", "draft"], queryFn: () => api.posts.list("draft") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["posts"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const queue = useMutation({ mutationFn: (id: string) => api.posts.queue(id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.posts.remove(id), onSuccess: refresh });

  const list = (drafts.data ?? []).filter((p) => p.content.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        title="Drafts"
        subtitle="Posts you've saved for later. Polish one, queue it, or post it."
        actions={
          <Button onClick={() => navigate("/write")}>
            <PenLine className="size-4" /> New post
          </Button>
        }
      />

      {!!drafts.data?.length && (
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Search drafts" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <ErrorText error={queue.error ?? remove.error} />

      {drafts.isLoading ? (
        <Spinner />
      ) : list.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((p) => (
            <Card key={p.id} className="flex flex-col p-4">
              <Link to={`/posts/${p.id}`} className="flex-1">
                <div className="line-clamp-6 text-sm leading-relaxed whitespace-pre-wrap text-slate-800">
                  {p.content || <i className="text-slate-400">Empty draft</i>}
                </div>
              </Link>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-400">
                  {p.content.length} chars · {formatWhen(p.updatedAt, settings.data?.timezone)}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="danger"
                    className="px-2 py-1 text-xs"
                    aria-label="Delete draft"
                    onClick={() => {
                      if (confirm("Delete this draft?")) remove.mutate(p.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    className="py-1 text-xs"
                    disabled={!p.content.trim()}
                    loading={queue.isPending && queue.variables === p.id}
                    onClick={() => queue.mutate(p.id)}
                  >
                    <CalendarPlus className="size-3.5" /> Queue
                  </Button>
                  <Button className="py-1 text-xs" onClick={() => navigate(`/posts/${p.id}`)}>
                    Edit
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-slate-500">
          {q ? "No drafts match your search." : "No drafts yet. Generate posts on the Write page and click “Save draft”."}
        </p>
      )}
    </>
  );
}
