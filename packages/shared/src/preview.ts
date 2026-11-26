import { LINKEDIN_FOLD_CHARS, LINKEDIN_FOLD_CHARS_MOBILE, LINKEDIN_FOLD_LINES, type PreviewDevice } from "./types";

/** Split a post into the part shown above LinkedIn's "...see more" fold and the rest. */
export function splitAtFold(content: string, device: PreviewDevice = "desktop"): { visible: string; hidden: string } {
  const maxChars = device === "mobile" ? LINKEDIN_FOLD_CHARS_MOBILE : LINKEDIN_FOLD_CHARS;
  const lines = content.split("\n");
  let visible = "";
  let lineCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = visible ? `${visible}\n${line}` : line;
    lineCount++;
    if (next.length > maxChars) {
      const room = maxChars - (visible ? visible.length + 1 : 0);
      const cut = Math.max(0, room);
      visible = visible ? `${visible}\n${line.slice(0, cut)}` : line.slice(0, cut);
      return { visible, hidden: content.slice(visible.length) };
    }
    visible = next;
    if (lineCount >= LINKEDIN_FOLD_LINES && i < lines.length - 1) {
      return { visible, hidden: content.slice(visible.length) };
    }
  }
  return { visible: content, hidden: "" };
}

/** The hook = everything above the fold. */
export function hookOf(content: string): string {
  return splitAtFold(content).visible;
}

/**
 * Replace the post's opening hook with `hook`, keeping the rest as is. A hook with N
 * paragraphs replaces the post's first N paragraphs (at least one). If the post has no
 * blank lines, only its first line is replaced.
 */
export function replaceHook(content: string, hook: string): string {
  const paras = (t: string) => t.trim().split(/\n[ \t]*\n\s*/);
  const newHook = hook.trim();
  const body = paras(content);
  if (body.length === 1) {
    const nl = body[0].indexOf("\n");
    return nl === -1 ? newHook : `${newHook}\n${body[0].slice(nl + 1)}`;
  }
  const n = Math.min(paras(newHook).length, body.length - 1);
  return [newHook, ...body.slice(Math.max(1, n))].join("\n\n");
}

// --- Hashtags ---
const TAG_CHARS = "[\\p{L}\\p{N}_]+";
const TAG_LINE = new RegExp(`^\\s*(#${TAG_CHARS}\\s*)+$`, "u");

/** "#remote work!" -> "#RemoteWork", "AI" -> "#AI". Empty string if nothing usable is left. */
export function normalizeHashtag(raw: string): string {
  const words = raw.replace(/^#+/, "").split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  if (!words.length) return "";
  // Capitalize words typed all in lowercase; keep the case of anything else ("iPhone", "AI").
  const cap = (w: string) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w);
  const body = words.map(cap).join("");
  return body.length > 60 ? "" : `#${body}`;
}

/** Every hashtag in the post, as written ("#Leadership"). */
export function hashtagsIn(content: string): string[] {
  return [...content.matchAll(new RegExp(`(?:^|[^\\p{L}\\p{N}_#&/])#(${TAG_CHARS})`, "gu"))].map((m) => `#${m[1]}`);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Where a hashtag is in the post: on the hashtag line at the end, inside the text, or not at all. */
export function hashtagPlace(content: string, tag: string): "tagline" | "inline" | null {
  const lines = content.trimEnd().split("\n");
  const last = lines.at(-1) ?? "";
  if (TAG_LINE.test(last) && hashtagsIn(last).some((t) => same(t, tag))) return "tagline";
  return hashtagsIn(content).some((t) => same(t, tag)) ? "inline" : null;
}

/**
 * Add a hashtag to the hashtag line at the end of the post (starting one if needed), or take
 * it off that line. Hashtags inside the text itself are left alone.
 */
export function toggleHashtag(content: string, tag: string): string {
  const lines = content.trimEnd().split("\n");
  const last = lines.at(-1) ?? "";
  const hasTagLine = lines.length > 0 && TAG_LINE.test(last);
  const place = hashtagPlace(content, tag);
  if (place === "inline") return content;
  if (place === "tagline") {
    const rest = hashtagsIn(last).filter((t) => !same(t, tag));
    if (rest.length) return [...lines.slice(0, -1), rest.join(" ")].join("\n");
    return lines.slice(0, -1).join("\n").trimEnd();
  }
  if (hasTagLine) return [...lines.slice(0, -1), `${last.trim()} ${tag}`].join("\n");
  const body = content.trimEnd();
  return body ? `${body}\n\n${tag}` : tag;
}

/** Add every hashtag in `tags` that the post doesn't have yet. */
export function addHashtags(content: string, tags: string[]): string {
  return tags.reduce((c, t) => (hashtagPlace(c, t) ? c : toggleHashtag(c, t)), content);
}
