// Pure helpers from the shared package: hook replacement, LinkedIn fold, PDF writer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addHashtags, buildPdf, hashtagPlace, hashtagsIn, normalizeHashtag, replaceHook, splitAtFold, toggleHashtag } from "@postdaily/shared";
import { toLittleText } from "../src/lib/linkedin";

test("replaceHook swaps the first paragraph and keeps the rest", () => {
  assert.equal(replaceHook("Old hook\nline two\n\nBody one\n\nBody two", "New hook"), "New hook\n\nBody one\n\nBody two");
  assert.equal(replaceHook("\n\n  Old\n \nBody", "New"), "New\n\nBody");
  // No blank lines: only the first line is the hook.
  assert.equal(replaceHook("Old hook\nsecond line", "New"), "New\nsecond line");
  assert.equal(replaceHook("Only line", " New "), "New");
  // A two-paragraph hook replaces the first two paragraphs, but never the whole post.
  assert.equal(replaceHook("A\n\nB\n\nC", "X\n\nY"), "X\n\nY\n\nC");
  assert.equal(replaceHook("A\n\nB", "X\n\nY\n\nZ"), "X\n\nY\n\nZ\n\nB");
});

test("fold: phone cuts sooner than desktop", () => {
  const text = "x".repeat(180);
  assert.equal(splitAtFold(text, "desktop").hidden, "");
  assert.equal(splitAtFold(text, "mobile").visible.length, 140);
  assert.equal(splitAtFold("a\nb\nc\nd", "desktop").visible, "a\nb\nc");
});

test("little text escapes reserved characters and keeps hashtags", () => {
  assert.equal(toLittleText("#ship it #2026"), "{hashtag|\\#|ship} it {hashtag|\\#|2026}");
  assert.equal(toLittleText("a (b) @c #tag_1 *x*"), "a \\(b\\) \\@c {hashtag|\\#|tag\\_1} \\*x\\*");
});

test("buildPdf writes a valid structure with correct xref offsets", () => {
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, ...Array(n).fill(7), 0xff, 0xd9]);
  const bytes = buildPdf(
    [
      { jpeg: jpeg(10), width: 1080, height: 1350 },
      { jpeg: jpeg(20), width: 1080, height: 1350 },
    ],
    "My (deck) ✨",
  );
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.match(text, /\/Type \/Pages \/Count 2 \/Kids \[4 0 R 7 0 R\]/);
  assert.match(text, /\/MediaBox \[0 0 540 675\]/);
  assert.match(text, /\/Title \(My \\\(deck\\\) \)/);

  // startxref points at "xref", and every xref entry points at "<n> 0 obj".
  const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const entries = text.slice(startxref).split("\n").slice(3, 3 + 9);
  entries.forEach((e, i) => {
    const off = Number(e.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`);
  });
  // Image streams are embedded byte for byte with the right length.
  const lengths = [...text.matchAll(/\/DCTDecode \/Length (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(lengths, [14, 24]);
  assert.throws(() => buildPdf([]));
});

test("hashtags: normalize, find, and toggle on the hashtag line at the end", () => {
  assert.equal(normalizeHashtag("remote work!"), "#RemoteWork");
  assert.equal(normalizeHashtag("##AI"), "#AI");
  assert.equal(normalizeHashtag("#  "), "");
  assert.equal(normalizeHashtag("#Führung"), "#Führung");

  assert.deepEqual(hashtagsIn("We use #AI daily.\nNot C# or a&#39;s url.com/#anchor\n\n#Leadership #ai"), ["#AI", "#Leadership", "#ai"]);

  // Adding starts a hashtag line, then extends it.
  let post = "Big lesson.\n\nShip small.  \n";
  post = toggleHashtag(post, "#Leadership");
  assert.equal(post, "Big lesson.\n\nShip small.\n\n#Leadership");
  post = toggleHashtag(post, "#Startups");
  assert.equal(post, "Big lesson.\n\nShip small.\n\n#Leadership #Startups");
  assert.equal(hashtagPlace(post, "#startups"), "tagline", "case-insensitive");

  // Removing takes it off the line; removing the last one drops the line.
  post = toggleHashtag(post, "#leadership");
  assert.equal(post, "Big lesson.\n\nShip small.\n\n#Startups");
  post = toggleHashtag(post, "#Startups");
  assert.equal(post, "Big lesson.\n\nShip small.");

  // A hashtag inside the text is left alone.
  const inline = "We bet on #AI this year.";
  assert.equal(hashtagPlace(inline, "#AI"), "inline");
  assert.equal(toggleHashtag(inline, "#AI"), inline);
  assert.equal(toggleHashtag("", "#AI"), "#AI");
});

test("addHashtags adds only the missing ones from a set", () => {
  assert.equal(addHashtags("Post #AI here.\n\n#Leadership", ["#leadership", "#AI", "#Startups", "#Growth"]), "Post #AI here.\n\n#Leadership #Startups #Growth");
  assert.equal(addHashtags("Post", []), "Post");
});
