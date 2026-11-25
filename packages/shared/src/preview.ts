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
