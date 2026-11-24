import { useState } from "react";
import { splitAtFold } from "@postdaily/shared";
import { Globe, MessageSquare, Repeat2, Send, ThumbsUp } from "lucide-react";

export function LinkedInPreview({ content, name, picture }: { content: string; name: string; picture?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const { visible, hidden } = splitAtFold(content);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 p-3">
        {picture ? (
          <img src={picture} alt="" className="size-11 rounded-full object-cover" />
        ) : (
          <div className="flex size-11 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold">{name}</div>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            now · <Globe className="size-3" />
          </div>
        </div>
      </div>
      <div className="px-3 pb-3 text-[14px] leading-5 whitespace-pre-wrap break-words text-slate-900">
        {content ? (
          <>
            {visible}
            {hidden &&
              (expanded ? (
                hidden
              ) : (
                <>
                  …{" "}
                  <button className="text-slate-500 hover:text-brand-600 hover:underline" onClick={() => setExpanded(true)}>
                    more
                  </button>
                </>
              ))}
          </>
        ) : (
          <span className="text-slate-400">Your post preview appears here.</span>
        )}
      </div>
      {hidden && (
        <div className="border-t border-dashed border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          The first {visible.length} characters are visible above “…more”. Make them count.
        </div>
      )}
      <div className="flex justify-around border-t border-slate-100 py-1.5 text-xs font-medium text-slate-500">
        {[
          [ThumbsUp, "Like"],
          [MessageSquare, "Comment"],
          [Repeat2, "Repost"],
          [Send, "Send"],
        ].map(([Icon, label]: any) => (
          <span key={label} className="flex items-center gap-1.5 px-2 py-1">
            <Icon className="size-4" /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
