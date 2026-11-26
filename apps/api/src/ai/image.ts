// AI images for posts, made with FLUX.1 [schnell] on Workers AI (Cloudflare only; part of the
// free daily Workers AI allowance). Each image counts toward the account's daily image limit.
import { IMAGE_STYLES, type ImageStyle } from "@postdaily/shared";
import { dailyLimit, takeAllowance } from "../lib/usage";
import { AIError, AILimitError, limitMessage } from "./providers";
import { workersAiBinding } from "./transcribe";

export const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
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

export async function generateImage(userId: string, description: string, style: ImageStyle): Promise<string> {
  const ai = workersAiBinding();
  if (!ai) throw new AIError("Image generation needs the Cloudflare deployment (it uses Workers AI).");
  if (!(style in IMAGE_STYLES)) throw new AIError("Unknown image style");
  if (!(await takeAllowance(userId, "image"))) throw new AILimitError(limitMessage("image", dailyLimit("image")));
  let out: unknown;
  try {
    out = await Promise.race([
      ai.run(IMAGE_MODEL, { prompt: imagePrompt(description, style).slice(0, 2000), steps: 8 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS)),
    ]);
  } catch (e) {
    throw new AIError(`Image generation failed: ${(e as Error).message}. Try again.`);
  }
  const b64 = (out as { image?: unknown })?.image;
  if (typeof b64 !== "string" || b64.length < 100) throw new AIError("The image model returned nothing. Try again.");
  const type = b64.startsWith("iVBOR") ? "png" : b64.startsWith("UklGR") ? "webp" : "jpeg";
  return `data:image/${type};base64,${b64}`;
}
