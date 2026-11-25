// Prompt building and the AI features: drafts, rewrites, ideas, style analysis.
import { z } from "zod";
import type { Carousel, CarouselSlide, Draft, PostLength, Profile, RewriteAction, Settings } from "@postdaily/shared";
import { aiSlideSchema } from "../lib/carousel";
import { AIError, complete } from "./providers";

/** Phrases that make a post sound machine-written. Always avoided. */
export const DEFAULT_BANNED = [
  "In today's fast-paced world",
  "delve",
  "game-changer",
  "unlock the power",
  "leverage",
  "I'm thrilled to announce",
  "I'm humbled",
  "Let that sink in",
  "Here's the thing",
  "buckle up",
  "navigate the landscape",
  "tapestry",
  "synergy",
  "Agree?",
];

const LENGTH_GUIDE: Record<PostLength, string> = {
  short: "400-700 characters",
  medium: "900-1400 characters",
  long: "1500-2300 characters",
};

/** Profile plus recently published posts (newest first), used as extra voice examples. */
export type VoiceProfile = Profile & { learnedPosts?: string[] };

function voiceBlock(profile: VoiceProfile) {
  const learned = (profile.learnedPosts ?? []).slice(0, 4).join("\n\n---\n\n");
  const banned = [...DEFAULT_BANNED, ...profile.bannedPhrases].filter(Boolean);
  return [
    profile.niche && `Author's niche/role: ${profile.niche}`,
    profile.audience && `Target audience: ${profile.audience}`,
    profile.goals && `What the author wants from LinkedIn: ${profile.goals}`,
    profile.topics.length && `Topics they post about: ${profile.topics.join(", ")}`,
    profile.styleGuide && `Author's writing style guide (follow it closely):\n${profile.styleGuide}`,
    profile.samplePosts &&
      `Examples of the author's own past posts (match this voice, do not copy content):\n<examples>\n${profile.samplePosts.slice(0, 6000)}\n</examples>`,
    learned &&
      `The author's most recently published posts (their current voice, after their own edits; do not repeat these topics):\n<recent>\n${learned.slice(0, 5000)}\n</recent>`,
    `Never use these phrases or close variants: ${banned.map((b) => `"${b}"`).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function systemPrompt(profile: VoiceProfile) {
  return `You ghost-write LinkedIn posts for one specific person. The posts must sound like a real human wrote them - this person - not like AI.

LinkedIn craft rules:
- The first 1-2 lines (about 200 characters) are the hook shown above "...see more". Make them specific and curiosity-driving; no throat-clearing.
- Short paragraphs, 1-3 sentences each, separated by blank lines. Plenty of white space.
- Plain text only: LinkedIn does not render markdown, so no **bold**, no headings, no markdown bullets. Simple "-" or "→" list lines are fine.
- Concrete details, numbers and personal experience beat generic advice.
- At most 3 hashtags, only at the very end, and only if they fit the author's style.
- Emojis only if the author's style uses them.
- Avoid em dashes; use commas, periods or hyphens.
- Never invent specific facts about the author (employers, metrics, events) that the input does not support. If a story needs a detail you don't have, write around it.

${voiceBlock(profile)}`;
}

/** Pull the first JSON object out of a model response (handles ``` fences and chatter). */
function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new AIError("The AI response was not valid JSON. Try again.");
  const candidate = raw.slice(start, end + 1);
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    try {
      // Models often put real line breaks inside long strings, which isn't valid JSON.
      value = JSON.parse(escapeControlCharsInStrings(candidate));
    } catch (e) {
      console.warn("[ai] invalid JSON:", (e as Error).message, JSON.stringify(candidate.slice(0, 300)));
      throw new AIError("The AI response was not valid JSON. Try again.");
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.warn("[ai] unexpected shape:", parsed.error.issues[0]?.message, JSON.stringify(candidate.slice(0, 300)));
    throw new AIError("The AI response had an unexpected shape. Try again.");
  }
  return parsed.data;
}

/** Escape raw newlines/tabs that appear inside JSON string literals. */
export function escapeControlCharsInStrings(json: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") continue;
      else if (ch === "\t") {
        out += "\\t";
        continue;
      }
    } else if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

const stripMarkdown = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();

/** If the input is a URL, fetch the page and return its readable text. */
async function expandInput(input: string): Promise<string> {
  const url = input.trim();
  if (!/^https?:\/\/\S+$/.test(url)) return input;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 PostDaily" } });
    // Cap the page size: keeps the text cleanup cheap (Cloudflare's free plan allows 10 ms CPU).
    const html = (await res.text()).slice(0, 300_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    const body = html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
    return `Write about this article (${url}).\nTitle: ${title}\n\nArticle text:\n${body}\n\nShare the author's own take on it; don't just summarise. Mention the link is in the comments only if natural.`;
  } catch {
    return `Write about this link: ${url}`;
  }
}

export async function generateDrafts(
  settings: Settings,
  profile: VoiceProfile,
  input: string,
  length: PostLength,
): Promise<Draft[]> {
  const expanded = await expandInput(input);
  const prompt = `Turn the input below into 3 different LinkedIn post drafts, each ${LENGTH_GUIDE[length]}.

Use three different angles:
1. "Story" - a personal, narrative take.
2. "Lesson" - practical, actionable takeaways.
3. "Opinion" - a clear, slightly contrarian point of view.

<input>
${expanded}
</input>

The input may be rough notes or a spoken voice-note transcript with filler words and false starts. Keep the substance and the author's own details; drop the filler.

Respond with only JSON in this exact shape:
{"drafts":[{"angle":"Story","content":"..."},{"angle":"Lesson","content":"..."},{"angle":"Opinion","content":"..."}]}
Use \\n for line breaks inside content.`;

  const text = await complete(settings.aiProvider, {
    system: systemPrompt(profile),
    prompt,
    model: settings.aiModel,
    effort: "medium",
  });
  const parsed = parseJson(text, z.object({ drafts: z.array(z.object({ angle: z.string(), content: z.string() })).min(1) }));
  return parsed.drafts.map((d) => ({ angle: d.angle, content: stripMarkdown(d.content) }));
}

const REWRITE_PROMPTS: Record<RewriteAction, string> = {
  new_hook: "Rewrite only the opening hook (first 1-2 lines) to be more specific and scroll-stopping. Keep the rest unchanged.",
  shorter: "Make it about 40% shorter. Keep the hook and the core point.",
  longer: "Expand it by about 40% with one more concrete example or detail, without padding.",
  casual: "Make the tone more casual and conversational, like talking to a friend.",
  professional: "Make the tone more polished and professional, without becoming stiff.",
  punchier: "Make it punchier: shorter sentences, stronger verbs, cut filler words.",
  add_cta: "End with a natural question or call to action that invites comments. Keep everything else.",
  fix_formatting: "Fix the formatting for LinkedIn: short paragraphs, blank lines between them, no markdown. Do not change the wording more than needed.",
  carousel_caption:
    "This post will go out with a swipeable document carousel that already covers the details. Rewrite it as a short caption (300-600 characters): a strong hook, one or two lines of context that make people want to swipe, without repeating every point, and end with a natural nudge to swipe through (for example \"Swipe through →\") and a question that invites comments.",
  custom: "",
};

export async function rewritePost(
  settings: Settings,
  profile: VoiceProfile,
  content: string,
  action: RewriteAction,
  instruction?: string,
): Promise<string> {
  const task = action === "custom" ? instruction?.trim() : REWRITE_PROMPTS[action];
  if (!task) throw new AIError("Tell me what to change.");
  const prompt = `Edit this LinkedIn post. ${task}

<post>
${content}
</post>

Respond with only the full edited post text - no preamble, no quotes, no explanation.`;
  const text = await complete(settings.aiProvider, {
    system: systemPrompt(profile),
    prompt,
    model: settings.aiModel,
    effort: "low",
  });
  return stripMarkdown(text.replace(/^<post>\s*|\s*<\/post>$/g, ""));
}

export async function generateIdeas(
  settings: Settings,
  profile: VoiceProfile,
  recentPosts: string[],
  existingIdeas: string[],
  count = 5,
): Promise<string[]> {
  const prompt = `Suggest ${count} fresh LinkedIn post ideas for today for this author.

Each idea is one or two sentences: the specific angle plus what the post would say, written so the author can react to it with their own experience. Mix formats (story, lesson, opinion, how-to, behind-the-scenes, question to the audience). Make them specific to the author's niche, not generic.

${recentPosts.length ? `Recent posts (don't repeat these topics):\n${recentPosts.map((p) => `- ${p.slice(0, 160).replace(/\n/g, " ")}`).join("\n")}` : ""}
${existingIdeas.length ? `Ideas already in the bank (don't duplicate):\n${existingIdeas.map((i) => `- ${i}`).join("\n")}` : ""}

Respond with only JSON: {"ideas":["...","..."]}`;
  const text = await complete(settings.aiProvider, {
    system: systemPrompt(profile),
    prompt,
    model: settings.aiModel,
    effort: "low",
  });
  return parseJson(text, z.object({ ideas: z.array(z.string()).min(1) })).ideas.slice(0, count);
}

export async function analyzeStyle(settings: Settings, profile: VoiceProfile): Promise<{ styleGuide: string; topics: string[] }> {
  const corpus = [profile.samplePosts, ...(profile.learnedPosts ?? [])].filter((x) => x.trim()).join("\n\n---\n\n");
  if (corpus.trim().length < 200)
    throw new AIError("Paste at least 2-3 of your past posts (200+ characters) so I can learn your style.");
  const prompt = `Study these LinkedIn posts written by one person and describe how they write, so another writer could imitate them.

<posts>
${corpus.slice(0, 15000)}
</posts>

Write a concise style guide as plain-text bullet lines starting with "- ", covering: tone and personality, typical hook style, sentence and paragraph length, formatting habits (line breaks, lists, arrows), use of emojis, use of hashtags, how posts end (questions, CTAs), recurring phrases or words they like, and things they never do.

Also list 3-8 topics they post about.

Respond with only JSON: {"styleGuide":"- ...\\n- ...","topics":["..."]}`;
  const text = await complete(settings.aiProvider, {
    system: "You are an expert editor who analyses writing style precisely and concisely.",
    prompt,
    model: settings.aiModel,
    effort: "medium",
  });
  return parseJson(text, z.object({ styleGuide: z.string(), topics: z.array(z.string()) }));
}

/** Three alternative opening hooks for a post. */
export async function generateHooks(settings: Settings, profile: VoiceProfile, content: string): Promise<string[]> {
  const prompt = `Write 3 alternative opening hooks for this LinkedIn post. The hook is the first 1-2 lines shown above "...see more" (under 200 characters).

Make each one a different style: a specific surprising claim, a short story opening, and a direct question or contrarian take. They must fit the rest of the post, which stays as is.

<post>
${content}
</post>

Respond with only JSON: {"hooks":["...","...","..."]}. Use \\n for a line break inside a hook.`;
  const text = await complete(settings.aiProvider, {
    system: systemPrompt(profile),
    prompt,
    model: settings.aiModel,
    effort: "low",
  });
  return parseJson(text, z.object({ hooks: z.array(z.string()).min(1) }))
    .hooks.map((h) => stripMarkdown(h))
    .filter(Boolean)
    .slice(0, 3);
}

const SLIDE_GUIDE = `Slide types (pick the one that fits each idea best; vary them):
- "cover": first slide. heading = a bold, specific headline (max 8 words) that makes people swipe; body = optional one-line subtitle.
- "text": heading (max 8 words) + body (max 30 words).
- "list": heading + items (3-5 short points, max 10 words each), shown numbered.
- "checklist": heading + items (3-5 short actions), shown with check marks.
- "stat": stat = a short number like "3x", "47%" or "$12k" (only if the input supports it; never invent numbers) + heading (what it measures) + body (one line of context).
- "quote": heading = the quote itself (max 25 words, no quote marks) + body = who said it (or empty).
- "compare": heading + labels (two short column titles, e.g. ["Before","After"] or ["Myth","Reality"]) + items (left column, 2-4 points) + items2 (right column, same count).
- "cta": last slide. heading = the takeaway or a question that invites comments; body = a short nudge such as "Follow for more on <topic>" or "Repost if this helps".

Rules: no emojis, no hashtags, no markdown except: wrap 1-2 key words per slide in *single stars* to highlight them. No slide numbers.`;

const carouselShape = z.object({
  title: z.string().default("Carousel"),
  caption: z.string().optional(),
  slides: z.array(aiSlideSchema).min(2),
});

/**
 * Outline a 5-8 slide carousel. From a finished post (`content`), or from a rough idea or
 * link (`fromIdea`), in which case it also writes a short caption for the post.
 */
export async function generateCarousel(
  settings: Settings,
  profile: VoiceProfile,
  content: string,
  { fromIdea = false } = {},
): Promise<Carousel> {
  const source = fromIdea ? await expandInput(content) : content;
  const prompt = `Turn this ${fromIdea ? "idea" : "LinkedIn post"} into a document carousel (a swipeable PDF) of 5 to 8 slides.

${SLIDE_GUIDE}

Start with a "cover" slide and end with a "cta" slide.

<${fromIdea ? "idea" : "post"}>
${source}
</${fromIdea ? "idea" : "post"}>
${
  fromIdea
    ? `\nAlso write "caption": the LinkedIn post text that goes with the carousel, 300-600 characters: a strong hook, a line or two of context, a nudge to swipe through and a question. Follow the author's voice.\n`
    : ""
}
Respond with only JSON: {"title":"short document title",${fromIdea ? '"caption":"...",' : ""}"slides":[{"type":"cover","heading":"...","body":"..."}, ...]}`;
  const text = await complete(settings.aiProvider, {
    system: systemPrompt(profile),
    prompt,
    model: settings.aiModel,
    effort: "low",
  });
  const parsed = parseJson(text, carouselShape);
  const slides = parsed.slides.slice(0, 10);
  if (slides[0].type === "text") slides[0].type = "cover";
  return {
    title: stripMarkdown(parsed.title).slice(0, 120) || "Carousel",
    slides,
    ...(fromIdea && parsed.caption ? { caption: stripMarkdown(parsed.caption) } : {}),
  };
}

/** Three alternative cover headlines. */
export async function generateCoverHeadlines(
  settings: Settings,
  profile: VoiceProfile,
  content: string,
  current: string,
): Promise<string[]> {
  const prompt = `This is the cover headline of a LinkedIn document carousel: "${current}"

Write 3 alternative cover headlines (max 8 words each) that make people stop and swipe. Different styles: a bold specific claim, a number-led promise, and a curiosity gap. Wrap the 1-2 most important words in *single stars*. No emojis, no hashtags.

The carousel is about this post:
<post>
${content.slice(0, 3000)}
</post>

Respond with only JSON: {"headlines":["...","...","..."]}`;
  const text = await complete(settings.aiProvider, { system: systemPrompt(profile), prompt, model: settings.aiModel, effort: "low" });
  return parseJson(text, z.object({ headlines: z.array(z.string()).min(1) }))
    .headlines.map((h) => h.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^["']|["']$/g, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Rewrite one slide (same type unless the instruction asks otherwise). */
export async function rewriteSlide(
  settings: Settings,
  profile: VoiceProfile,
  content: string,
  slide: CarouselSlide,
  instruction?: string,
): Promise<CarouselSlide> {
  const { image: _image, notes, locked: _locked, ...rest } = slide;
  const prompt = `Rewrite this slide of a LinkedIn document carousel. ${instruction?.trim() || "Make it sharper and more specific, and keep it short."}

${SLIDE_GUIDE}

Current slide (keep its type unless asked to change it):
${JSON.stringify(rest)}
${notes?.trim() ? `\nThe author's private notes for this slide (use as context; never put them on the slide):\n${notes.trim()}\n` : ""}
The carousel is about this post:
<post>
${content.slice(0, 3000)}
</post>

Respond with only JSON: the rewritten slide object, e.g. {"type":"${slide.type ?? "text"}","heading":"...","body":"..."}`;
  const text = await complete(settings.aiProvider, { system: systemPrompt(profile), prompt, model: settings.aiModel, effort: "low" });
  const next = parseJson(text, aiSlideSchema);
  // Keep what the AI doesn't own: the image, private notes and lock state.
  return {
    ...next,
    ...(slide.image ? { image: slide.image } : {}),
    ...(slide.notes ? { notes: slide.notes } : {}),
    ...(slide.locked ? { locked: true } : {}),
  };
}

/** Formats rotated across a planned week, so posts written in parallel don't come out alike. */
export const PLAN_FORMATS = [
  "a personal story with a turning point",
  "a practical lesson with clear takeaways",
  "a clear, slightly contrarian opinion",
  "a step-by-step how-to",
  "a behind-the-scenes look at how the work actually happens",
  "a mistake the author made and what changed after",
  "a question to the audience, framed by the author's own experience",
];

/** Write one post per item (theme + format), all different. */
export async function generatePlannedPosts(
  settings: Settings,
  profile: VoiceProfile,
  items: { pillar: string; format: string }[],
  recentPosts: string[],
): Promise<string[]> {
  const prompt = `Write ${items.length} complete LinkedIn posts for this author's upcoming week, each ${LENGTH_GUIDE[settings.defaultLength]}.

One post per line below, in order (theme | format):
${items.map((it, i) => `${i + 1}. ${it.pillar} | format: ${it.format}`).join("\n")}

Be specific to the author; if a post needs a personal detail you don't have, write around it rather than inventing facts.
${recentPosts.length ? `\nRecent posts (don't repeat these):\n${recentPosts.map((p) => `- ${p.slice(0, 140).replace(/\n/g, " ")}`).join("\n")}\n` : ""}
Respond with only JSON: {"posts":["full post 1","full post 2"]} with exactly ${items.length} posts in the same order. Use \\n for line breaks.`;
  const text = await complete(settings.aiProvider, {
    system: systemPrompt(profile),
    prompt,
    model: settings.aiModel,
    effort: "medium",
  });
  // Some models wrap each post in an object; accept {"content"} / {"text"} / {"post"} too.
  const item = z.union([
    z.string(),
    z.object({ content: z.string() }).transform((o) => o.content),
    z.object({ text: z.string() }).transform((o) => o.text),
    z.object({ post: z.string() }).transform((o) => o.post),
  ]);
  const posts = parseJson(text, z.object({ posts: z.array(item).min(1) })).posts.map(stripMarkdown);
  return posts.slice(0, items.length);
}
