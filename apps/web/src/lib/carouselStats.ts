import type { CarouselSlide } from "@postdaily/shared";

export interface SlideStats {
  characterCount: number;
  wordCount: number;
  contentExists: boolean;
}

export interface CarouselStats {
  totalCharacters: number;
  totalWords: number;
  averageSlideLength: number;
  estimatedReadingTimeSeconds: number;
  slides: SlideStats[];
}

export function getSlideStats(slide: CarouselSlide): SlideStats {
  const text = [
    slide.heading ?? "",
    slide.body ?? "",
    ...(slide.items || []),
    ...(slide.items2 || []),
    slide.stat || "",
  ].join(" ");

  const trimmed = text.trim();
  const characterCount = trimmed.length;
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const contentExists = !!(
    slide.heading?.trim() ||
    slide.body?.trim() ||
    slide.items?.some((i) => i.trim()) ||
    slide.items2?.some((i) => i.trim()) ||
    slide.stat?.trim() ||
    slide.image
  );

  return {
    characterCount,
    wordCount,
    contentExists,
  };
}

export function getCarouselStats(slides: CarouselSlide[]): CarouselStats {
  const slideStats = slides.map(getSlideStats);
  const totalCharacters = slideStats.reduce((sum, s) => sum + s.characterCount, 0);
  const totalWords = slideStats.reduce((sum, s) => sum + s.wordCount, 0);
  const averageSlideLength = slides.length > 0 ? Math.round(totalCharacters / slides.length) : 0;

  // Assume 200 words per minute reading speed, adjust for slide processing time
  const readingTimeSeconds = Math.max(
    Math.round((totalWords / 200) * 60) + slides.length * 3,
    slides.length * 2,
  );

  return {
    totalCharacters,
    totalWords,
    averageSlideLength,
    estimatedReadingTimeSeconds: readingTimeSeconds,
    slides: slideStats,
  };
}

export function findAndReplace(
  slides: CarouselSlide[],
  searchTerm: string,
  replaceTerm: string,
  caseSensitive: boolean = false,
): CarouselSlide[] {
  if (!searchTerm) return slides;

  const regex = new RegExp(
    searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    `g${caseSensitive ? "" : "i"}`,
  );

  // Function replacer so "$&" etc. in the replacement are treated literally.
  const sub = (t: string) => t.replace(regex, () => replaceTerm);

  return slides.map((slide) =>
    slide.locked
      ? slide
      : {
          ...slide,
          heading: slide.heading == null ? slide.heading : sub(slide.heading),
          body: slide.body == null ? slide.body : sub(slide.body),
          items: slide.items?.map(sub),
          items2: slide.items2?.map(sub),
          notes: slide.notes == null ? slide.notes : sub(slide.notes),
        },
  );
}

/** "45s", "1m 20s", "3m". */
export function formatReadingTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}
