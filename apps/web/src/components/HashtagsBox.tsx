// Hashtags in the post editor: your usual hashtags and saved sets, plus AI suggestions.
// Tapping a hashtag adds it to (or takes it off) the hashtag line at the end of the post.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check, Hash, X } from "lucide-react";
import { addHashtags, hashtagPlace, hashtagsIn, toggleHashtag, type MyHashtags } from "@postdaily/shared";
import { api } from "../lib/api";
import { Button, ErrorText } from "./ui";

function Chip({ tag, content, edit, extra }: { tag: string; content: string; edit: (c: string) => void; extra?: string }) {
  const place = hashtagPlace(content, tag);
  return (
    <button
      aria-pressed={!!place}
      disabled={place === "inline"}
      title={place === "inline" ? "Already in your text" : place ? "Remove from the post" : "Add to the end of the post"}
      onClick={() => edit(toggleHashtag(content, tag))}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
        place ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-700 hover:border-brand-500"
      } disabled:cursor-default`}
    >
      {place && <Check className="size-3" />}
      {tag}
      {extra && <span className="text-slate-400">{extra}</span>}
    </button>
  );
}

export function HashtagsBox({ content, edit, busy }: { content: string; edit: (c: string) => void; busy: boolean }) {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ["my-hashtags"], queryFn: api.hashtags.mine });
  const suggest = useMutation({ mutationFn: () => api.ai.hashtags(content) });
  const onMine = (d: MyHashtags) => qc.setQueryData(["my-hashtags"], d);
  const saveSet = useMutation({ mutationFn: (p: { name: string; tags: string[] }) => api.hashtags.saveSet(p.name, p.tags), onSuccess: onMine });
  const removeSet = useMutation({ mutationFn: (id: string) => api.hashtags.removeSet(id), onSuccess: onMine });

  const inPost = hashtagsIn(content);
  const tagCount = inPost.length;
  const frequent = mine.data?.frequent ?? [];
  const sets = mine.data?.sets ?? [];
  const lower = new Set(inPost.map((t) => t.toLowerCase()));
  const sameAsSet = sets.some((s) => s.tags.length === lower.size && s.tags.every((t) => lower.has(t.toLowerCase())));

  return (
    <div className="mb-3 space-y-2.5 rounded-lg bg-slate-50 p-3">
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
          loading={suggest.isPending}
          onClick={() => suggest.mutate()}
        >
          <Hash className="size-3.5" /> {suggest.data ? "Suggest again" : "Suggest popular hashtags"}
        </Button>
      </div>

      {sets.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-slate-500">Your sets</div>
          <div className="flex flex-wrap gap-1.5">
            {sets.map((s) => {
              const all = s.tags.every((t) => hashtagPlace(content, t));
              return (
                <span key={s.id} className="flex items-center rounded-full border border-slate-200 bg-white text-xs">
                  <button
                    className={`flex items-center gap-1 rounded-l-full py-1 pr-1.5 pl-2.5 ${all ? "text-brand-700" : "text-slate-700 hover:text-brand-600"}`}
                    title={`${all ? "Already added" : "Add"}: ${s.tags.join(" ")}`}
                    disabled={all}
                    onClick={() => edit(addHashtags(content, s.tags))}
                  >
                    {all ? <Check className="size-3" /> : <Bookmark className="size-3" />}
                    {s.name} <span className="text-slate-400">{s.tags.length}</span>
                  </button>
                  <button
                    className="rounded-r-full py-1 pr-2 pl-1 text-slate-400 hover:text-red-600"
                    aria-label={`Delete set ${s.name}`}
                    onClick={() => confirm(`Delete the set "${s.name}"?`) && removeSet.mutate(s.id)}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {frequent.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-slate-500">Your usual (from your posts)</div>
          <div className="flex flex-wrap gap-1.5">
            {frequent.map((f) => (
              <Chip key={f.tag} tag={f.tag} content={content} edit={edit} extra={`${f.count}×`} />
            ))}
          </div>
        </div>
      )}

      {suggest.data &&
        (["broad", "niche"] as const).map((kind) => {
          const list = suggest.data.hashtags.filter((h) => h.kind === kind);
          if (!list.length) return null;
          return (
            <div key={kind}>
              <div className="mb-1 text-xs text-slate-500">{kind === "broad" ? "Suggested · widely followed" : "Suggested · specific to this post"}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map(({ tag }) => (
                  <Chip key={tag} tag={tag} content={content} edit={edit} />
                ))}
              </div>
            </div>
          );
        })}
      {suggest.data && (
        <p className="text-xs text-slate-500">
          Suggestions are picked by AI from hashtags popular on LinkedIn. LinkedIn doesn't publish live trends, so treat them as a starting point.
        </p>
      )}

      {tagCount > 0 && !sameAsSet && (
        <button
          className="flex items-center gap-1 text-xs text-brand-600 hover:underline disabled:opacity-50"
          disabled={saveSet.isPending}
          onClick={() => {
            const name = prompt(`Name this set (${inPost.join(" ")}):`, "My usual");
            if (name?.trim()) saveSet.mutate({ name: name.trim(), tags: inPost });
          }}
        >
          <Bookmark className="size-3" /> Save these {tagCount} as a set
        </button>
      )}
      <ErrorText error={suggest.error ?? saveSet.error ?? removeSet.error ?? mine.error} />
    </div>
  );
}
