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
