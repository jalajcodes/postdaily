// Validation for carousel slides and designs (used when saving a carousel or brand settings).
import { z } from "zod";
import {
  CAROUSEL_FONTS,
  CAROUSEL_ILLUSTRATIONS,
  CAROUSEL_PATTERNS,
  CAROUSEL_THEMES,
  MAX_CAROUSEL_SLIDES,
  MAX_SLIDE_IMAGE_BYTES,
  MAX_SLIDE_IMAGES,
  SLIDE_TYPES,
  type CarouselSlide,
  type SlideType,
} from "@postdaily/shared";

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color like #0a66c2");
const item = z.string().max(200);

export const designSchema = z.object({
  theme: z.enum(keys(CAROUSEL_THEMES)),
  pattern: z.enum(keys(CAROUSEL_PATTERNS)),
  font: z.enum(keys(CAROUSEL_FONTS)),
  accent: hex,
  accent2: hex.optional(),
  intensity: z.enum(["subtle", "normal", "bold"]).optional(),
  illustration: z.enum(keys(CAROUSEL_ILLUSTRATIONS)).optional(),
  illustrationOn: z.enum(["featured", "all"]).optional(),
  align: z.enum(["left", "center"]).optional(),
  textSize: z.enum(["s", "m", "l"]).optional(),
  highlight: z.enum(["auto", "color", "marker", "underline", "pill"]).optional(),
  pageNumbers: z.boolean().optional(),
  progressBar: z.boolean().optional(),
  swipeCue: z.boolean().optional(),
});

export const brandSchema = designSchema.extend({
  handle: z.string().trim().max(60),
  showAvatar: z.boolean(),
  logo: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Logo must be a PNG, JPEG or WebP image")
    .max(200_000, "Logo is too large (max ~150 KB)")
    .nullable(),
});

export const slideSchema = z.object({
  type: z.enum(keys(SLIDE_TYPES)).optional(),
  heading: z.string().max(200),
  body: z.string().max(600),
  items: z.array(item).max(8).optional(),
  items2: z.array(item).max(8).optional(),
  labels: z.tuple([z.string().max(40), z.string().max(40)]).optional(),
  stat: z.string().max(24).optional(),
  image: z
    .string()
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, "Slide images must be JPEG")
    .max(Math.ceil(MAX_SLIDE_IMAGE_BYTES * 1.37) + 100, "A slide image is too large")
    .optional(),
  /** Private notes for this slide (never drawn on the slide or sent to LinkedIn). */
  notes: z.string().max(500).optional(),
  /** Locked against accidental edits in the editor. */
  locked: z.boolean().optional(),
});

export const slidesSchema = z
  .array(slideSchema)
  .min(1)
  .max(MAX_CAROUSEL_SLIDES)
  .refine((s) => s.filter((x) => x.image).length <= MAX_SLIDE_IMAGES, `At most ${MAX_SLIDE_IMAGES} slides can have images`);

/** Lenient shape for AI output: unknown types become plain text slides. */
export const aiSlideSchema = z
  .object({
    type: z.string().optional(),
    heading: z.string().default(""),
    body: z.string().default(""),
    items: z.array(z.string()).optional(),
    items2: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
    stat: z.union([z.string(), z.number()]).optional(),
  })
  .transform((s): CarouselSlide => {
    const type = (s.type && s.type in SLIDE_TYPES && s.type !== "image" ? s.type : "text") as SlideType;
    const clean = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "*$1*").trim();
    // The slide draws its own numbers / check marks, so drop any the model added.
    const cleanItem = (t: string) => clean(t).replace(/^(?:[-•*→✓✔☑✅]|\d{1,2}[.)])\s+/u, "").trim();
    return {
      type,
      heading: clean(s.heading).slice(0, 200),
      body: clean(s.body).slice(0, 600),
      ...(s.items?.length ? { items: s.items.map(cleanItem).filter(Boolean).slice(0, 8) } : {}),
      ...(s.items2?.length ? { items2: s.items2.map(cleanItem).filter(Boolean).slice(0, 8) } : {}),
      ...(s.labels?.length === 2 ? { labels: [s.labels[0].slice(0, 40), s.labels[1].slice(0, 40)] as [string, string] } : {}),
      ...(s.stat !== undefined && String(s.stat).trim() ? { stat: String(s.stat).trim().slice(0, 24) } : {}),
    };
  });
