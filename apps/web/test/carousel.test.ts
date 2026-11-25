import test from "node:test";
import assert from "node:assert/strict";
import { UndoRedo, type HistoryState } from "../src/lib/carouselHistory.ts";
import { findAndReplace, formatReadingTime, getCarouselStats } from "../src/lib/carouselStats.ts";
import { clearDraft, draftDiffers, loadDraft, saveDraft } from "../src/lib/carouselDraft.ts";
import { SLIDE_TEMPLATES } from "../src/lib/carouselTemplates.ts";
import { ILLUSTRATION_IDS, illustrationShapeCount } from "../src/lib/illustrations.ts";
import { CAROUSEL_ILLUSTRATIONS } from "@postdaily/shared";

const st = (title: string): HistoryState => ({ slides: [], design: {} as any, title });
const slide = (o: any = {}) => ({ type: "content", heading: "Hello", body: "world", ...o }) as any;

test("undo returns the state before the last edit, even after one edit", () => {
  const h = new UndoRedo();
  h.push(st("A")); // A -> B
  assert.equal(h.undo(st("B"))?.title, "A");
  assert.equal(h.canUndo(), false);
});

test("undo steps back one edit at a time and redo returns forward", () => {
  const h = new UndoRedo();
  h.push(st("A"));
  h.push(st("B")); // A -> B -> C
  assert.equal(h.undo(st("C"))?.title, "B");
  assert.equal(h.undo(st("B"))?.title, "A");
  assert.equal(h.redo(st("A"))?.title, "B");
  assert.equal(h.redo(st("B"))?.title, "C");
  assert.equal(h.redo(st("C")), null);
});

test("new edit clears redo; history is capped at 50", () => {
  const h = new UndoRedo();
  h.push(st("A"));
  h.undo(st("B"));
  assert.ok(h.canRedo());
  h.push(st("X"));
  assert.equal(h.canRedo(), false);
  const h2 = new UndoRedo();
  for (let i = 0; i < 80; i++) h2.push(st(String(i)));
  let n = 0;
  while (h2.undo(st("cur"))) n++;
  assert.equal(n, 50);
});

test("findAndReplace skips locked slides and treats input literally", () => {
  const out = findAndReplace(
    [slide({ heading: "a.b" }), slide({ heading: "a.b", locked: true })],
    "a.b",
    "$&!",
  );
  assert.equal(out[0].heading, "$&!");
  assert.equal(out[1].heading, "a.b");
});

test("findAndReplace is case-insensitive by default, optional sensitivity, handles missing fields", () => {
  const s = [slide({ heading: "Foo foo", body: undefined, notes: "FOO" })];
  assert.equal(findAndReplace(s, "foo", "x")[0].heading, "x x");
  assert.equal(findAndReplace(s, "foo", "x", true)[0].heading, "Foo x");
  assert.equal(findAndReplace(s, "foo", "x")[0].notes, "x");
});

test("stats tolerate missing fields and count words", () => {
  const s = getCarouselStats([slide({ body: undefined }), slide({ heading: "", body: "" })]);
  assert.equal(s.slides[0].wordCount, 1);
  assert.equal(s.slides[1].contentExists, false);
});

/** In-memory stand-in for localStorage. */
function memoryStore(failWrites = false) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

test("drafts are kept per post, restored, and cleared", () => {
  const store = memoryStore();
  const design = { theme: "bold", pattern: "dots", font: "inter", accent: "#0a66c2" } as any;
  saveDraft("post-a", { title: "A", slides: [slide({ heading: "edited" })], design }, store);
  saveDraft("post-b", { title: "B", slides: [], design }, store);
  const a = loadDraft("post-a", store)!;
  assert.equal(a.title, "A");
  assert.equal(a.slides[0].heading, "edited");
  assert.ok(!Number.isNaN(Date.parse(a.savedAt)));
  assert.equal(loadDraft("post-b", store)!.title, "B", "another post's draft is separate");
  clearDraft("post-a", store);
  assert.equal(loadDraft("post-a", store), null);
  assert.equal(loadDraft("post-b", store)!.title, "B");
});

test("drafts: a full or broken storage never throws", () => {
  const design = { theme: "bold" } as any;
  assert.equal(saveDraft("p", { title: "x", slides: [], design }, memoryStore(true)), false);
  const bad = memoryStore();
  bad.setItem("postdaily.carouselDraft.p", "{not json");
  assert.equal(loadDraft("p", bad), null);
  assert.equal(loadDraft("p", null), null);
});

test("a draft is only offered when it differs from what the editor opened with", () => {
  const design = { theme: "bold", accent: "#000" } as any;
  const base = { title: "T", slides: [slide()], design };
  assert.equal(draftDiffers({ ...base, savedAt: "" }, base), false);
  assert.equal(draftDiffers({ ...base, title: "T2", savedAt: "" }, base), true);
  assert.equal(draftDiffers({ ...base, slides: [slide({ heading: "x" })], savedAt: "" }, base), true);
  assert.equal(draftDiffers({ ...base, design: { ...design, accent: "#fff" }, savedAt: "" }, base), true);
});

test("reading time is readable for short carousels", () => {
  assert.equal(formatReadingTime(0), "0s");
  assert.equal(formatReadingTime(45), "45s");
  assert.equal(formatReadingTime(60), "1m");
  assert.equal(formatReadingTime(80), "1m 20s");
});

test("templates: no quote marks on quote slides, no hidden text on list slides, valid sizes", () => {
  for (const t of SLIDE_TEMPLATES) {
    for (const s of t.slides) {
      if (s.type === "quote") assert.ok(!/^["“]/.test(s.heading), `${t.name}: quote slide draws its own quote marks`);
      if (s.type === "list" || s.type === "checklist") assert.equal(s.body, "", `${t.name}: list body is never drawn`);
      assert.ok((s.items?.length ?? 0) <= 8, `${t.name}: at most 8 items`);
    }
    assert.ok(t.slides.length >= 2 && t.slides.length <= 12, `${t.name}: 2-12 slides`);
  }
});

test("every illustration in the picker has line art to draw", () => {
  const offered = Object.keys(CAROUSEL_ILLUSTRATIONS).filter((k) => k !== "none").sort();
  assert.deepEqual([...ILLUSTRATION_IDS].sort(), offered, "picker and artwork list match");
  for (const id of ILLUSTRATION_IDS) assert.ok(illustrationShapeCount(id) > 0, `${id} has shapes`);
});
