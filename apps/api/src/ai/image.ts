// AI images for posts, made with FLUX on Workers AI (Cloudflare only; part of the free daily
// Workers AI allowance, ~100 Neurons an image with either model). Each image counts toward the
// account's daily image limit.
import { IMAGE_MODELS, IMAGE_STYLES, type ImageModel, type ImageStyle } from "@postdaily/shared";
import { dailyLimit, takeAllowance } from "../lib/usage";
import { AIError, AILimitError, limitMessage } from "./providers";
import { workersAiBinding } from "./transcribe";

export const IMAGE_MODEL_IDS: Record<ImageModel, string> = {
  fast: "@cf/black-forest-labs/flux-1-schnell",
  better: "@cf/black-forest-labs/flux-2-klein-4b",
};
const TIMEOUT_MS = 60_000;

export const imageAvailable = () => Boolean(workersAiBinding());

/** What each style adds to the prompt. Text in images comes out garbled, so it's always ruled out. */
const STYLE_SUFFIX: Record<ImageStyle, string> = {
  photo: "Editorial photograph, natural light, shallow depth of field, realistic, high detail",
  illustration: "Flat vector illustration, clean shapes, limited color palette, modern editorial style",
  "3d": "Soft 3D render, clay style, pastel colors, studio lighting, minimal background",
  minimal: "Minimalist abstract composition, lots of negative space, bold simple shapes, two or three colors",
};

export function imagePrompt(description: string, style: ImageStyle) {
  return `${description.trim().replace(/\.$/, "")}. ${STYLE_SUFFIX[style]}. No text, no letters, no words, no logos, no watermarks.`;
}

/** FLUX.1 takes JSON; FLUX.2 takes a multipart form (a `prompt` field is required). */
async function modelInput(model: ImageModel, prompt: string) {
  if (model === "fast") return { prompt, steps: 8 };
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", "1024");
  form.append("height", "1024");
  const body = new Response(form);
  return { multipart: { body: body.body, contentType: body.headers.get("content-type") } };
}

// FLUX.2's safety filter sometimes flags harmless images; a second try usually works.
const isFlagged = (e: unknown) => /flagged/i.test((e as Error)?.message ?? "");

export async function generateImage(userId: string, description: string, style: ImageStyle, model: ImageModel = "better"): Promise<string> {
  const ai = workersAiBinding();
  if (!ai) throw new AIError("Image generation needs the Cloudflare deployment (it uses Workers AI).");
  if (!(style in IMAGE_STYLES)) throw new AIError("Unknown image style");
  if (!(model in IMAGE_MODELS)) throw new AIError("Unknown image model");
  if (!(await takeAllowance(userId, "image"))) throw new AILimitError(limitMessage("image", dailyLimit("image")));
  const prompt = imagePrompt(description, style).slice(0, 2000);
  const run = async () =>
    Promise.race([
      ai.run(IMAGE_MODEL_IDS[model], await modelInput(model, prompt)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS)),
    ]);
  let out: unknown;
  try {
    try {
      out = await run();
    } catch (e) {
      if (!isFlagged(e)) throw e;
      out = await run();
    }
  } catch (e) {
    if (isFlagged(e))
      throw new AIError(
        "The image model's safety filter blocked this one (it sometimes flags harmless images). Try again, change the description, or switch to Fast.",
      );
    throw new AIError(`Image generation failed: ${(e as Error).message}. Try again.`);
  }
  const b64 = (out as { image?: unknown })?.image;
  if (typeof b64 !== "string" || b64.length < 100) throw new AIError("The image model returned nothing. Try again.");
  const type = b64.startsWith("iVBOR") ? "png" : b64.startsWith("UklGR") ? "webp" : "jpeg";
  return `data:image/${type};base64,${b64}`;
}
