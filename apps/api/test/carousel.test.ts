// Carousels: AI outlines with slide types, cover headlines, slide rewrites, saving designs,
// brand settings and the avatar proxy. Real HTTP app + real DB; only external HTTP is faked.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createApp } from "../src/app";
import { createSession } from "../src/lib/auth";
import { db } from "../src/db";
import { aiReply, createUser, setup } from "./helpers";

let t: Awaited<ReturnType<typeof setup>>;
let token: string;
const app = createApp();
let ai: (prompt: string) => unknown = () => ({});
const prompts: string[] = [];

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`http://test.local/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, type, body: type.includes("json") ? ((await res.json()) as any) : Buffer.from(await res.arrayBuffer()) };
}

const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4").toString("base64");
const jpeg = "data:image/jpeg;base64," + Buffer.from("fakejpeg").toString("base64");
const design = { theme: "dark", pattern: "topo", font: "poppins", accent: "#7c3aed" };

before(async () => {
  t = await setup();
  t.route((c) => {
    if (!c.url.endsWith("/chat/completions")) return undefined;
    const prompt = c.body.messages.map((m: any) => m.content).join("\n");
    prompts.push(prompt);
    return aiReply(ai(prompt));
  });
  await createUser("u1");
  token = await createSession("u1");
});

test("brand settings: defaults, round trip, and validation", async () => {
  const s0 = (await call("GET", "/settings")).body;
  assert.equal(s0.carouselBrand.theme, "bold");
  assert.equal(s0.carouselBrand.showAvatar, true);

  const brand = { ...design, handle: "@alex", showAvatar: false, logo: "data:image/png;base64,iVBORw0KGgo=" };
  const r = await call("PUT", "/settings", { carouselBrand: brand });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.carouselBrand, brand);
  assert.deepEqual((await call("GET", "/settings")).body.carouselBrand, brand);

  assert.equal((await call("PUT", "/settings", { carouselBrand: { ...brand, accent: "purple" } })).status, 400);
  assert.equal((await call("PUT", "/settings", { carouselBrand: { ...brand, pattern: "plaid" } })).status, 400);
  assert.equal((await call("PUT", "/settings", { carouselBrand: { ...brand, logo: "https://evil.test/x.png" } })).status, 400);
});

test("make a carousel from an idea: caption becomes the post, slides are typed and cleaned, brand design applied", async () => {
  ai = () => ({
    title: "Hiring lessons",
    caption: "We hired for curiosity.\n\nSwipe through →",
    slides: [
      { type: "text", heading: "Hire for **curiosity**", body: "Not credentials" }, // first slide -> cover
      { type: "list", heading: "3 signals", items: ["1. Asks why", "", "✓ Admits gaps", "- *Owns* mistakes", "10x output"] },
      { type: "stat", stat: 3, heading: "times faster ramp-up", body: "" },
      { type: "compare", heading: "Interview", labels: ["Old", "New"], items: ["Trivia"], items2: ["Pairing"] },
      { type: "hologram", heading: "Unknown type", body: "becomes text" },
      { type: "cta", heading: "What's your *one* signal?", body: "Follow for more" },
    ],
  });
  const r = await call("POST", "/posts/carousel", { input: "hiring for curiosity over credentials" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body;
  assert.equal(p.content, "We hired for curiosity.\n\nSwipe through →");
  assert.equal(p.hasDocument, false, "not attached until the PDF is built");
  assert.equal(p.documentTitle, "Hiring lessons");
  assert.deepEqual(p.carouselDesign, design, "uses the brand's default look");
  const s = p.carouselSlides;
  assert.equal(s[0].type, "cover");
  assert.equal(s[0].heading, "Hire for *curiosity*", "markdown bold becomes a highlight");
  assert.deepEqual(s[1].items, ["Asks why", "Admits gaps", "*Owns* mistakes", "10x output"], "model-added bullets removed");
  assert.equal(s[2].stat, "3");
  assert.deepEqual(s[3].labels, ["Old", "New"]);
  assert.equal(s[4].type, "text");
  assert.equal(s[5].type, "cta");
  assert.match(prompts.at(-1)!, /<idea>[\s\S]*hiring for curiosity/);
  assert.match(prompts.at(-1)!, /"caption"/);

  // Attaching the PDF with a (changed) design keeps typed slides and stores the design.
  const slides = [...s.slice(0, 2), { type: "image", heading: "Our board", body: "", image: jpeg }];
  const doc = await call("PUT", `/posts/${p.id}/document`, { dataUrl: pdf, title: "Hiring lessons", slides, design: { ...design, theme: "paper" } });
  assert.equal(doc.status, 200, JSON.stringify(doc.body));
  assert.equal(doc.body.hasDocument, true);
  assert.equal(doc.body.carouselDesign.theme, "paper");
  assert.equal(doc.body.carouselSlides[2].image, jpeg);
});

test("document validation: too many slide images, bad slide image type, bad design", async () => {
  const { body: post } = await call("POST", "/posts", { content: "x" });
  const img = { type: "image", heading: "", body: "", image: jpeg };
  const three = await call("PUT", `/posts/${post.id}/document`, { dataUrl: pdf, title: "t", slides: [img, img, img] });
  assert.equal(three.status, 400);
  assert.match(three.body.error, /At most 2 slides/);
  const png = await call("PUT", `/posts/${post.id}/document`, {
    dataUrl: pdf,
    title: "t",
    slides: [{ type: "image", heading: "", body: "", image: "data:image/png;base64,AAAA" }, { heading: "b", body: "" }],
  });
  assert.equal(png.status, 400);
  const badDesign = await call("PUT", `/posts/${post.id}/document`, {
    dataUrl: pdf,
    title: "t",
    slides: [{ heading: "a", body: "" }, { heading: "b", body: "" }],
    design: { ...design, font: "comic-sans" },
  });
  assert.equal(badDesign.status, 400);
});

test("cover headlines and single-slide rewrite (keeps the slide's image)", async () => {
  ai = () => ({ headlines: ['"Hire **curious** people"', "3 signals that beat a CV", "Why we stopped asking trivia", "extra"] });
  const c = await call("POST", "/ai/carousel/covers", { content: "post", current: "Old cover" });
  assert.deepEqual(c.body.headlines, ["Hire *curious* people", "3 signals that beat a CV", "Why we stopped asking trivia"]);
  assert.match(prompts.at(-1)!, /Old cover/);

  ai = () => ({ type: "checklist", heading: "Do this", items: ["One", "Two"] });
  const r = await call("POST", "/ai/carousel/slide", {
    content: "post",
    slide: { type: "image", heading: "Screenshot", body: "caption", image: jpeg },
    instruction: "make it a checklist",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.slide.type, "checklist");
  assert.equal(r.body.slide.image, jpeg, "image kept");
  assert.ok(!prompts.at(-1)!.includes("fakejpeg") && !prompts.at(-1)!.includes(jpeg), "image bytes are not sent to the AI");
  assert.match(prompts.at(-1)!, /make it a checklist/);
});

test("carousel caption rewrite is a quick fix", async () => {
  ai = () => "Short teaser.\n\nSwipe through →";
  const r = await call("POST", "/ai/rewrite", { content: "A long post with every detail.", action: "carousel_caption" });
  assert.equal(r.status, 200);
  assert.equal(r.body.content, "Short teaser.\n\nSwipe through →");
  assert.match(prompts.at(-1)!, /short caption/);
});

test("avatar proxy: serves your LinkedIn photo, refuses other hosts", async () => {
  t.route((c) => (c.url === "https://media.licdn.com/dms/image/me.jpg" ? new Response("JPEGBYTES", { headers: { "content-type": "image/jpeg" } }) : undefined));
  await db.run("UPDATE users SET picture = 'https://media.licdn.com/dms/image/me.jpg' WHERE id = 'u1'");
  const ok = await call("GET", "/me/avatar");
  assert.equal(ok.status, 200);
  assert.equal(ok.type, "image/jpeg");
  assert.equal(ok.body.toString(), "JPEGBYTES");

  for (const url of ["http://media.licdn.com/x.jpg", "https://evil.test/x.jpg", "https://licdn.com.evil.test/x.jpg", null]) {
    await db.run("UPDATE users SET picture = ? WHERE id = 'u1'", url);
    t.calls.length = 0;
    assert.equal((await call("GET", "/me/avatar")).status, 404, String(url));
    assert.equal(t.calls.length, 0, `no fetch for ${url}`);
  }
});
