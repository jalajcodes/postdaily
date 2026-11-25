// Unsaved carousel edits, kept per post in this browser so a closed tab or crash doesn't lose
// work. Cleared when the carousel is attached or the editor is cancelled.
import type { CarouselDesign, CarouselSlide } from "@postdaily/shared";

export interface CarouselDraft {
  title: string;
  slides: CarouselSlide[];
  design: CarouselDesign;
  savedAt: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const key = (postId: string) => `postdaily.carouselDraft.${postId}`;
const fallback = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function saveDraft(postId: string, draft: Omit<CarouselDraft, "savedAt">, store = fallback()) {
  if (!store) return false;
  try {
    store.setItem(key(postId), JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false; // Storage full (big slide images) or blocked: drafts are best-effort.
  }
}

export function loadDraft(postId: string, store = fallback()): CarouselDraft | null {
  if (!store) return null;
  try {
    const d = JSON.parse(store.getItem(key(postId)) ?? "null");
    return d && Array.isArray(d.slides) && d.design && typeof d.title === "string" ? d : null;
  } catch {
    return null;
  }
}

export function clearDraft(postId: string, store = fallback()) {
  try {
    store?.removeItem(key(postId));
  } catch {}
}

/** True if the draft differs from what the editor opened with (so restoring would change something). */
export function draftDiffers(draft: CarouselDraft, current: { title: string; slides: CarouselSlide[]; design: CarouselDesign }) {
  return (
    draft.title !== current.title ||
    JSON.stringify(draft.design) !== JSON.stringify(current.design) ||
    JSON.stringify(draft.slides) !== JSON.stringify(current.slides)
  );
}
