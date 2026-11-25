import { useState } from "react";
import { splitAtFold, type PreviewDevice } from "@postdaily/shared";
import { Globe, Laptop, MessageSquare, Repeat2, Send, Smartphone, ThumbsUp } from "lucide-react";

export function LinkedInPreview({
  content,
  name,
  picture,
  image,
  firstComment,
}: {
  content: string;
  name: string;
  picture?: string | null;
  image?: string | null;
  firstComment?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const { visible, hidden } = splitAtFold(content, device);
  const avatar = (size: string) =>
    picture ? (
      <img src={picture} alt="" className={`${size} rounded-full object-cover`} />
    ) : (
      <div className={`flex ${size} items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700`}>
        {name.slice(0, 1).toUpperCase()}
      </div>
    );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Preview</span>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(
            [
              ["desktop", Laptop, "Desktop"],
              ["mobile", Smartphone, "Phone"],
            ] as const
          ).map(([d, Icon, label]) => (
            <button
              key={d}
              onClick={() => {
                setDevice(d);
                setExpanded(false);
              }}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${device === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              aria-pressed={device === d}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`mx-auto rounded-lg border border-slate-200 bg-white shadow-sm ${device === "mobile" ? "max-w-[340px]" : ""}`}>
        <div className="flex items-center gap-2.5 p-3">
          {avatar("size-11")}
          <div className="min-w-0">
            <div className="text-sm font-semibold">{name}</div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              now · <Globe className="size-3" />
            </div>
          </div>
        </div>
        <div className="px-3 pb-3 text-[14px] leading-5 break-words whitespace-pre-wrap text-slate-900">
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
        {image && <img src={image} alt="" className="w-full border-y border-slate-100 object-cover" />}
        {hidden && !expanded && (
          <div className="border-t border-dashed border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
            On {device === "mobile" ? "phones" : "desktop"}, the first {visible.length} characters show above “…more”.
          </div>
        )}
        <div className="flex justify-around border-t border-slate-100 py-1.5 text-xs font-medium text-slate-500">
          {(
            [
              [ThumbsUp, "Like"],
              [MessageSquare, "Comment"],
              [Repeat2, "Repost"],
              [Send, "Send"],
            ] as const
          ).map(([Icon, label]) => (
            <span key={label} className="flex items-center gap-1.5 px-2 py-1">
              <Icon className="size-4" /> {device === "desktop" && label}
            </span>
          ))}
        </div>
        {firstComment?.trim() && (
          <div className="flex gap-2 border-t border-slate-100 p-3">
            {avatar("size-8")}
            <div className="min-w-0 flex-1 rounded-lg bg-slate-100 px-3 py-2">
              <div className="text-xs font-semibold">
                {name} <span className="font-normal text-slate-500">· Author</span>
              </div>
              <div className="text-[13px] break-words whitespace-pre-wrap text-slate-800">{firstComment}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
