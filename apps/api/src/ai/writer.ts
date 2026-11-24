// Prompt building and the AI features: drafts, rewrites, ideas, style analysis.
import { z } from "zod";
import type { Draft, PostLength, Profile, RewriteAction, Settings } from "@postdaily/shared";
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

function voiceBlock(profile: Profile) {
  const banned = [...DEFAULT_BANNED, ...profile.bannedPhrases].filter(Boolean);
  return [
    profile.niche && `Author's niche/role: ${profile.niche}`,
    profile.audience && `Target audience: ${profile.audience}`,
    profile.goals && `What the author wants from LinkedIn: ${profile.goals}`,
    profile.topics.length && `Topics they post about: ${profile.topics.join(", ")}`,
    profile.styleGuide && `Author's writing style guide (follow it closely):\n${profile.styleGuide}`,
    profile.samplePosts &&
      `Examples of the author's own past posts (match this voice, do not copy content):\n<examples>\n${profile.samplePosts.slice(0, 6000)}\n</examples>`,
    `Never use these phrases or close variants: ${banned.map((b) => `"${b}"`).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function systemPrompt(profile: Profile) {
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
  try {
    return schema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new AIError("The AI response had an unexpected shape. Try again.");
  }
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
  profile: Profile,
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
  custom: "",
};

export async function rewritePost(
  settings: Settings,
  profile: Profile,
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
  profile: Profile,
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

export async function analyzeStyle(settings: Settings, profile: Profile): Promise<{ styleGuide: string; topics: string[] }> {
  if (profile.samplePosts.trim().length < 200)
    throw new AIError("Paste at least 2-3 of your past posts (200+ characters) so I can learn your style.");
  const prompt = `Study these LinkedIn posts written by one person and describe how they write, so another writer could imitate them.

<posts>
${profile.samplePosts.slice(0, 15000)}
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
