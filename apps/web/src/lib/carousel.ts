// Carousel rendering: draws each slide on a 1080x1350 canvas (LinkedIn's 4:5 document shape)
// from its type, the design (theme, pattern, font, accent) and your brand (photo, name, handle,
// logo). Also builds the PDF. Pure canvas, no dependencies.
import {
  CAROUSEL_FONTS,
  MAX_DOCUMENT_BYTES,
  MAX_SLIDE_IMAGE_BYTES,
  buildPdf,
  type CarouselDesign,
  type CarouselSlide,
  type SlideType,
} from "@postdaily/shared";

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;
const PAD = 96;

export interface SlideAssets {
  name: string;
  handle: string;
  showAvatar: boolean;
  avatar: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  /** Decoded slide images, keyed by data URL. */
  images: Map<string, HTMLImageElement>;
}

export const slideTypeOf = (s: CarouselSlide, i: number): SlideType => s.type ?? (i === 0 ? "cover" : "text");

// --- Colors ----------------------------------------------------------------------------------

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};
const rgba = (hex: string, a: number) => `rgba(${toRgb(hex).join(",")},${a})`;
const luminance = (hex: string) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

interface Palette {
  /** Solid background, or a gradient from bg to bg2. */
  bg: string;
  bg2?: string;
  fg: string;
  muted: string;
  accent: string;
  /** How highlighted (*starred*) words are drawn. */
  highlight: { style: "color" | "marker" | "underline"; color: string };
  /** Cards (compare columns, list badges) on this background. */
  card: string;
  pattern: string;
  patternAlpha: number;
}

/** Colors for one slide. Cover and closing slides are "featured" in some themes. */
function palette(design: CarouselDesign, featured: boolean): Palette {
  const a = design.accent;
  const onAccent = luminance(a) > 0.45 ? "#111827" : "#ffffff";
  const colored = (): Palette => ({
    bg: a,
    bg2: mix(a, "#000000", 0.35),
    fg: onAccent,
    muted: rgba(onAccent, 0.78),
    accent: onAccent,
    highlight: { style: "marker", color: rgba(onAccent === "#ffffff" ? "#ffffff" : "#000000", 0.22) },
    card: rgba(onAccent === "#ffffff" ? "#ffffff" : "#000000", 0.12),
    pattern: onAccent,
    patternAlpha: 0.14,
  });
  const light = (bg: string): Palette => ({
    bg,
    fg: "#0f172a",
    muted: "#475569",
    accent: a,
    highlight: { style: "color", color: a },
    card: rgba(a, 0.08),
    pattern: a,
    patternAlpha: 0.13,
  });
  switch (design.theme) {
    case "bold":
      return featured ? colored() : light("#f8fafc");
    case "gradient":
      return colored();
    case "light":
      return light("#ffffff");
    case "dark": {
      const hl = mix(a, "#ffffff", 0.35);
      return {
        bg: "#0b1020",
        bg2: featured ? mix("#0b1020", a, 0.35) : undefined,
        fg: "#f1f5f9",
        muted: "#94a3b8",
        accent: hl,
        highlight: { style: "color", color: hl },
        card: "rgba(255,255,255,0.07)",
        pattern: hl,
        patternAlpha: 0.16,
      };
    }
    case "paper":
      return {
        bg: "#f4efe6",
        fg: "#1c1917",
        muted: "#57534e",
        accent: a,
        highlight: { style: "color", color: a },
        card: "rgba(28,25,23,0.06)",
        pattern: "#1c1917",
        patternAlpha: 0.09,
      };
    case "mono":
      return featured
        ? {
            bg: "#0a0a0a",
            fg: "#ffffff",
            muted: "#a3a3a3",
            accent: "#ffffff",
            highlight: { style: "underline", color: "#ffffff" },
            card: "rgba(255,255,255,0.1)",
            pattern: "#ffffff",
            patternAlpha: 0.12,
          }
        : {
            bg: "#ffffff",
            fg: "#0a0a0a",
            muted: "#525252",
            accent: "#0a0a0a",
            highlight: { style: "underline", color: "#0a0a0a" },
            card: "rgba(0,0,0,0.05)",
            pattern: "#0a0a0a",
            patternAlpha: 0.08,
          };
  }
}

// --- Background patterns -------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let grainTile: HTMLCanvasElement | null = null;
function grain() {
  if (grainTile) return grainTile;
  grainTile = document.createElement("canvas");
  grainTile.width = grainTile.height = 160;
  const g = grainTile.getContext("2d")!;
  const img = g.createImageData(160, 160);
  const r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grainTile;
}

function drawPattern(ctx: CanvasRenderingContext2D, design: CarouselDesign, p: Palette, index: number) {
  const { pattern } = design;
  if (pattern === "none") return;
  const r = rng(index * 97 + 13);
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = p.pattern;
  ctx.globalAlpha = p.patternAlpha;
  switch (pattern) {
    case "dots": {
      // A dot grid fading out toward the bottom-left, so text stays clean.
      for (let y = 40; y < SLIDE_H; y += 44)
        for (let x = 40; x < SLIDE_W; x += 44) {
          const fade = Math.max(0, (x / SLIDE_W) * 1.2 - (y / SLIDE_H) * 0.6);
          if (fade <= 0.05) continue;
          ctx.globalAlpha = p.patternAlpha * Math.min(1, fade * 1.6);
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      break;
    }
    case "grid": {
      ctx.lineWidth = 2;
      ctx.globalAlpha = p.patternAlpha * 0.6;
      for (let x = 0; x <= SLIDE_W; x += 72) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, SLIDE_H);
        ctx.stroke();
      }
      for (let y = 0; y <= SLIDE_H; y += 72) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(SLIDE_W, y);
        ctx.stroke();
      }
      break;
    }
    case "diagonal": {
      ctx.lineWidth = 3;
      ctx.globalAlpha = p.patternAlpha * 0.55;
      for (let x = -SLIDE_H; x < SLIDE_W; x += 34) {
        ctx.beginPath();
        ctx.moveTo(x, SLIDE_H);
        ctx.lineTo(x + SLIDE_H, 0);
        ctx.stroke();
      }
      break;
    }
    case "waves": {
      ctx.lineWidth = 4;
      const phase = r() * Math.PI * 2;
      for (let k = 0; k < 9; k++) {
        ctx.globalAlpha = p.patternAlpha * (0.4 + k * 0.08);
        ctx.beginPath();
        for (let x = 0; x <= SLIDE_W; x += 12) {
          const y = SLIDE_H - 330 + k * 30 + Math.sin(x / 150 + phase + k * 0.35) * (26 + k * 3);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "blobs": {
      const spots = [
        [SLIDE_W * (0.85 + r() * 0.15), SLIDE_H * (0.05 + r() * 0.15), 520],
        [SLIDE_W * (r() * 0.2), SLIDE_H * (0.75 + r() * 0.2), 460],
      ];
      for (const [x, y, rad] of spots) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, rgba(p.pattern.startsWith("#") ? p.pattern : "#ffffff", 1));
        g.addColorStop(1, rgba(p.pattern.startsWith("#") ? p.pattern : "#ffffff", 0));
        ctx.globalAlpha = p.patternAlpha * 1.6;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
      }
      break;
    }
    case "rings": {
      ctx.lineWidth = 3;
      const cx = SLIDE_W - 60;
      const cy = 80;
      for (let rad = 60; rad < 900; rad += 48) {
        ctx.globalAlpha = p.patternAlpha * Math.max(0.15, 1 - rad / 900);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "topo": {
      ctx.lineWidth = 2.5;
      const cx = SLIDE_W * (0.75 + r() * 0.2);
      const cy = SLIDE_H * (0.12 + r() * 0.2);
      const wobble = Array.from({ length: 6 }, () => [r() * 0.25, r() * Math.PI * 2]);
      for (let k = 1; k < 18; k++) {
        const base = k * 46;
        ctx.globalAlpha = p.patternAlpha * Math.max(0.2, 1 - k / 18);
        ctx.beginPath();
        for (let t = 0; t <= Math.PI * 2 + 0.01; t += 0.05) {
          let rad = base;
          wobble.forEach(([amp, ph], j) => (rad += base * amp * 0.35 * Math.sin(t * (j + 2) + ph)));
          const x = cx + Math.cos(t) * rad;
          const y = cy + Math.sin(t) * rad * 0.85;
          t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "grain": {
      ctx.globalAlpha = 0.06;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = ctx.createPattern(grain(), "repeat")!;
      ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
      break;
    }
    case "corner": {
      ctx.globalAlpha = p.patternAlpha * 1.3;
      ctx.beginPath();
      ctx.arc(SLIDE_W + 40, -40, 340, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = p.patternAlpha * 0.9;
      ctx.beginPath();
      ctx.arc(SLIDE_W - 220, 250, 70, 0, Math.PI * 2);
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.save();
      ctx.translate(-60, SLIDE_H - 300);
      ctx.rotate(-0.35);
      ctx.fillRect(0, 0, 300, 300);
      ctx.restore();
      break;
    }
  }
  ctx.restore();
}

// --- Rich text (*highlights*) --------------------------------------------------------------------

type Word = { text: string; hl: boolean };
type Line = Word[];

function words(text: string): Word[][] {
  // Paragraphs -> words, each word flagged if inside *stars*.
  return text.split("\n").map((para) => {
    const out: Word[] = [];
    para.split(/(\*[^*]+\*)/).forEach((chunk) => {
      const hl = /^\*[^*]+\*$/.test(chunk);
      for (const w of (hl ? chunk.slice(1, -1) : chunk).split(/\s+/).filter(Boolean)) out.push({ text: w, hl });
    });
    return out;
  });
}

function wrapRich(ctx: CanvasRenderingContext2D, text: string, maxW: number): Line[] {
  const lines: Line[] = [];
  for (const para of words(text)) {
    let line: Line = [];
    for (const w of para) {
      const test = [...line, w].map((x) => x.text).join(" ");
      if (line.length && ctx.measureText(test).width > maxW) {
        lines.push(line);
        line = [w];
      } else line.push(w);
    }
    lines.push(line);
  }
  return lines;
}

interface Fit {
  size: number;
  lines: Line[];
  height: number;
  overflow: boolean;
}

/** Largest font size (from `max` down to `min`) where `text` fits in maxLines and maxH. */
function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: (size: number) => string,
  maxW: number,
  { max, min, maxLines = 99, maxH = Infinity, lh = 1.2 }: { max: number; min: number; maxLines?: number; maxH?: number; lh?: number },
): Fit {
  let last: Fit | null = null;
  for (let size = max; size >= min; size -= 2) {
    ctx.font = font(size);
    const lines = text.trim() ? wrapRich(ctx, text, maxW) : [];
    const height = lines.length * size * lh;
    const tooWide = lines.some((l) => l.length === 1 && ctx.measureText(l[0].text).width > maxW);
    last = { size, lines, height, overflow: lines.length > maxLines || height > maxH || tooWide };
    if (!last.overflow) return last;
  }
  return last!;
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  f: Fit,
  font: (size: number) => string,
  x: number,
  y: number,
  color: string,
  p: Palette,
  { lh = 1.2, align = "left", maxW = SLIDE_W - PAD * 2 }: { lh?: number; align?: "left" | "center"; maxW?: number } = {},
) {
  ctx.font = font(f.size);
  ctx.textBaseline = "alphabetic";
  const space = ctx.measureText(" ").width;
  f.lines.forEach((line, i) => {
    const baseline = y + f.size + i * f.size * lh - f.size * (lh - 1) * 0.5;
    const width = line.reduce((w, word, j) => w + ctx.measureText(word.text).width + (j ? space : 0), 0);
    let cx = align === "center" ? x + (maxW - width) / 2 : x;
    line.forEach((word, j) => {
      const w = ctx.measureText(word.text).width;
      const extra = j < line.length - 1 ? space : 0;
      if (word.hl) {
        // Joins with the next highlighted word so a phrase gets one continuous marker.
        const joinNext = j < line.length - 1 && line[j + 1].hl ? space : 0;
        if (p.highlight.style === "marker") {
          ctx.fillStyle = p.highlight.color;
          ctx.fillRect(cx - 6, baseline - f.size * 0.78, w + joinNext + 12, f.size * 0.98);
        } else if (p.highlight.style === "underline") {
          ctx.fillStyle = p.highlight.color;
          ctx.fillRect(cx, baseline + f.size * 0.1, w + joinNext, Math.max(4, f.size * 0.07));
        }
      }
      ctx.fillStyle = word.hl && p.highlight.style === "color" ? p.highlight.color : color;
      ctx.fillText(word.text, cx, baseline);
      cx += w + extra;
    });
  });
  return y + f.height;
}

// --- Slide ----------------------------------------------------------------------------------------

const fonts = (design: CarouselDesign) => {
  const pair = CAROUSEL_FONTS[design.font] ?? CAROUSEL_FONTS.inter;
  const h = `"${pair.heading}", system-ui, sans-serif`;
  const b = `"${pair.body}", system-ui, sans-serif`;
  return {
    heading: (s: number) => `700 ${s}px ${h}`,
    headingLight: (s: number) => `600 ${s}px ${h}`,
    body: (s: number) => `400 ${s}px ${b}`,
    bodyBold: (s: number) => `600 ${s}px ${b}`,
    pair,
  };
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawAvatar(ctx: CanvasRenderingContext2D, assets: SlideAssets, x: number, y: number, size: number, p: Palette) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  if (assets.avatar) {
    ctx.clip();
    const img = assets.avatar;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x, y, size, size);
  } else {
    ctx.fillStyle = p.card;
    ctx.fill();
    ctx.fillStyle = p.fg;
    ctx.font = `700 ${size * 0.42}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText((assets.name || "?").slice(0, 1).toUpperCase(), x + size / 2, y + size * 0.65);
    ctx.textAlign = "left";
  }
  ctx.restore();
}

function drawLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement, x: number, y: number, maxH: number) {
  const scale = Math.min(maxH / logo.naturalHeight, 320 / logo.naturalWidth);
  ctx.drawImage(logo, x, y, logo.naturalWidth * scale, logo.naturalHeight * scale);
}

function drawCheck(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.14;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + s * 0.22, y + s * 0.52);
  ctx.lineTo(x + s * 0.42, y + s * 0.72);
  ctx.lineTo(x + s * 0.78, y + s * 0.3);
  ctx.stroke();
  ctx.restore();
}

/** Draw one slide. `overflow` = some text had to be cut or squeezed below the minimum size. */
export function drawSlide(
  slide: CarouselSlide,
  index: number,
  total: number,
  design: CarouselDesign,
  assets: SlideAssets,
): { canvas: HTMLCanvasElement; overflow: boolean } {
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W;
  canvas.height = SLIDE_H;
  const ctx = canvas.getContext("2d")!;
  const type = slideTypeOf(slide, index);
  const featured = type === "cover" || type === "cta";
  const p = palette(design, featured);
  const F = fonts(design);
  let overflow = false;
  const note = (f: Fit) => ((overflow ||= f.overflow), f);

  // Background
  if (p.bg2) {
    const g = ctx.createLinearGradient(0, 0, SLIDE_W, SLIDE_H);
    g.addColorStop(0, p.bg);
    g.addColorStop(1, p.bg2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  drawPattern(ctx, design, p, index);
  if (!featured && design.theme === "bold") {
    ctx.fillStyle = design.accent;
    ctx.fillRect(0, 0, SLIDE_W, 14);
  }

  const maxW = SLIDE_W - PAD * 2;
  const top = featured ? 200 : 150;
  const bottom = SLIDE_H - 200; // footer area below
  const room = bottom - top;
  if (featured && assets.logo) drawLogo(ctx, assets.logo, PAD, 84, 72);

  // Vertically center a block of `h` in the content area.
  const startY = (h: number) => top + Math.max(0, (room - h) / 2);

  switch (type) {
    case "cover": {
      const h = note(fit(ctx, slide.heading, F.heading, maxW, { max: 112, min: 56, maxLines: 6, lh: 1.08 }));
      const b = note(fit(ctx, slide.body, F.body, maxW, { max: 48, min: 32, maxLines: 3, lh: 1.35 }));
      const total = 34 + h.height + (b.lines.length ? 40 + b.height : 0);
      let y = startY(total) - 40;
      ctx.fillStyle = p.accent;
      ctx.fillRect(PAD, y, 96, 12);
      y += 34;
      y = drawLines(ctx, h, F.heading, PAD, y, p.fg, p, { lh: 1.08 });
      if (b.lines.length) drawLines(ctx, b, F.body, PAD, y + 40, p.muted, p, { lh: 1.35 });
      break;
    }
    case "text": {
      const h = note(fit(ctx, slide.heading, F.heading, maxW, { max: 92, min: 48, maxLines: 5, lh: 1.12 }));
      const b = note(fit(ctx, slide.body, F.body, maxW, { max: 54, min: 30, maxH: room - h.height - 48, lh: 1.4 }));
      let y = startY(h.height + (b.lines.length ? 48 + b.height : 0));
      y = drawLines(ctx, h, F.heading, PAD, y, p.fg, p, { lh: 1.12 });
      if (b.lines.length) drawLines(ctx, b, F.body, PAD, y + 48, p.muted, p, { lh: 1.4 });
      break;
    }
    case "list":
    case "checklist": {
      const items = (slide.items ?? []).filter((t) => t.trim());
      const h = note(fit(ctx, slide.heading, F.heading, maxW, { max: 80, min: 44, maxLines: 3, lh: 1.12 }));
      const badge = 76;
      const textW = maxW - badge - 36;
      let size = 54;
      let fits: Fit[] = [];
      for (; size >= 26; size -= 2) {
        fits = items.map((t) => fit(ctx, t, F.body, textW, { max: size, min: size, lh: 1.3 }));
        const total = fits.reduce((s, f) => s + Math.max(badge, f.height) + 40, 0);
        if (total <= room - h.height - 56) break;
      }
      if (size < 26) overflow = true;
      const listH = fits.reduce((s, f) => s + Math.max(badge, f.height) + 40, 0) - 40;
      let y = startY(h.height + 56 + listH);
      y = drawLines(ctx, h, F.heading, PAD, y, p.fg, p, { lh: 1.12 }) + 56;
      fits.forEach((f, i) => {
        const rowH = Math.max(badge, f.height);
        if (type === "list") {
          ctx.fillStyle = p.accent;
          ctx.beginPath();
          ctx.arc(PAD + badge / 2, y + badge / 2, badge / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = featured || design.theme === "gradient" ? design.accent : p.bg;
          if (luminance(p.accent) > 0.6 && luminance(ctx.fillStyle as string) > 0.6) ctx.fillStyle = "#111827";
          ctx.font = F.heading(36);
          ctx.textAlign = "center";
          ctx.fillText(String(i + 1), PAD + badge / 2, y + badge / 2 + 13);
          ctx.textAlign = "left";
        } else {
          ctx.fillStyle = p.card;
          roundRect(ctx, PAD, y, badge, badge, 16);
          ctx.fill();
          drawCheck(ctx, PAD, y, badge, p.accent);
        }
        drawLines(ctx, f, F.body, PAD + badge + 36, y + Math.max(0, (badge - f.size * 1.3) / 2), p.fg, p, { lh: 1.3 });
        y += rowH + 40;
      });
      break;
    }
    case "stat": {
      const s = note(fit(ctx, slide.stat || "—", F.heading, maxW, { max: 280, min: 120, maxLines: 1, lh: 1 }));
      const h = note(fit(ctx, slide.heading, F.headingLight, maxW, { max: 76, min: 40, maxLines: 3, lh: 1.15 }));
      const b = note(fit(ctx, slide.body, F.body, maxW, { max: 50, min: 30, maxLines: 4, lh: 1.4 }));
      let y = startY(s.height + 30 + h.height + (b.lines.length ? 36 + b.height : 0));
      ctx.font = F.heading(s.size);
      ctx.fillStyle = p.highlight.style === "color" ? p.highlight.color : p.fg;
      ctx.fillText((slide.stat || "—").replace(/\*/g, ""), PAD - s.size * 0.04, y + s.size * 0.9);
      y += s.height + 30;
      y = drawLines(ctx, h, F.headingLight, PAD, y, p.fg, p, { lh: 1.15 });
      if (b.lines.length) drawLines(ctx, b, F.body, PAD, y + 36, p.muted, p, { lh: 1.4 });
      break;
    }
    case "quote": {
      const serif = F.pair.heading === "Playfair Display";
      const qFont = (s: number) => (serif ? `italic 600 ${s}px "Playfair Display", serif` : F.headingLight(s));
      const q = note(fit(ctx, slide.heading, qFont, maxW, { max: 92, min: 44, maxLines: 8, lh: 1.22 }));
      const by = slide.body.trim();
      let y = startY(140 + q.height + (by ? 70 : 0));
      ctx.fillStyle = p.accent;
      ctx.globalAlpha = 0.9;
      ctx.font = `700 260px Georgia, serif`;
      ctx.fillText("“", PAD - 14, y + 200);
      ctx.globalAlpha = 1;
      y = drawLines(ctx, q, qFont, PAD, y + 140, p.fg, p, { lh: 1.22 });
      if (by) {
        const a = note(fit(ctx, `— ${by.replace(/^[-—\s]+/, "")}`, F.bodyBold, maxW, { max: 40, min: 28, maxLines: 2, lh: 1.3 }));
        drawLines(ctx, a, F.bodyBold, PAD, y + 44, p.muted, p, { lh: 1.3 });
      }
      break;
    }
    case "compare": {
      const h = note(fit(ctx, slide.heading, F.heading, maxW, { max: 80, min: 42, maxLines: 3, lh: 1.12 }));
      const [l1, l2] = slide.labels ?? ["Before", "After"];
      const gap = 28;
      const colW = (maxW - gap) / 2;
      const inner = colW - 64;
      const cols = [slide.items ?? [], slide.items2 ?? []];
      let size = 46;
      let colFits: Fit[][] = [];
      let colH = 0;
      for (; size >= 24; size -= 2) {
        colFits = cols.map((items) => items.filter((t) => t.trim()).map((t) => fit(ctx, t, F.body, inner - 40, { max: size, min: size, lh: 1.28 })));
        colH = Math.max(...colFits.map((fs) => fs.reduce((s, f) => s + f.height + 34, 0))) + 150;
        if (colH <= room - h.height - 56) break;
      }
      if (size < 24) overflow = true;
      let y = startY(h.height + 56 + colH);
      y = drawLines(ctx, h, F.heading, PAD, y, p.fg, p, { lh: 1.12 }) + 56;
      colFits.forEach((fs, c) => {
        const x = PAD + c * (colW + gap);
        const strong = c === 1;
        ctx.fillStyle = strong ? rgba(p.accent.startsWith("#") ? p.accent : "#ffffff", 0.14) : p.card;
        roundRect(ctx, x, y, colW, colH, 28);
        ctx.fill();
        if (strong) {
          ctx.strokeStyle = p.accent;
          ctx.lineWidth = 3;
          roundRect(ctx, x, y, colW, colH, 28);
          ctx.stroke();
        }
        ctx.font = F.heading(38);
        ctx.fillStyle = strong ? p.accent : p.muted;
        ctx.fillText((c ? l2 : l1).toUpperCase(), x + 32, y + 78);
        let iy = y + 124;
        fs.forEach((f) => {
          ctx.fillStyle = strong ? p.accent : p.muted;
          if (strong) drawCheck(ctx, x + 20, iy + f.size * 0.12, f.size * 0.95, p.accent);
          else ctx.fillRect(x + 34, iy + f.size * 0.62, 18, 5);
          drawLines(ctx, f, F.body, x + 32 + 40, iy, strong ? p.fg : p.muted, p, { lh: 1.28 });
          iy += f.height + 34;
        });
      });
      break;
    }
    case "image": {
      const h = note(fit(ctx, slide.heading, F.heading, maxW, { max: 64, min: 40, maxLines: 3, lh: 1.12 }));
      const b = note(fit(ctx, slide.body, F.body, maxW, { max: 36, min: 26, maxLines: 3, lh: 1.35 }));
      const img = slide.image ? assets.images.get(slide.image) : undefined;
      const boxH = room - h.height - (h.lines.length ? 44 : 0) - (b.lines.length ? 36 + b.height : 0);
      let y = top;
      if (h.lines.length) y = drawLines(ctx, h, F.heading, PAD, y, p.fg, p, { lh: 1.12 }) + 44;
      if (img) {
        const scale = Math.min(maxW / img.naturalWidth, boxH / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const hh = img.naturalHeight * scale;
        const x = PAD + (maxW - w) / 2;
        ctx.save();
        roundRect(ctx, x, y, w, hh, 24);
        ctx.clip();
        ctx.drawImage(img, x, y, w, hh);
        ctx.restore();
        ctx.strokeStyle = rgba("#000000", 0.08);
        ctx.lineWidth = 2;
        roundRect(ctx, x, y, w, hh, 24);
        ctx.stroke();
        y += hh;
      } else {
        ctx.strokeStyle = p.muted;
        ctx.setLineDash([16, 12]);
        ctx.lineWidth = 3;
        roundRect(ctx, PAD, y, maxW, boxH, 24);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = F.body(34);
        ctx.fillStyle = p.muted;
        ctx.textAlign = "center";
        ctx.fillText("Add an image", SLIDE_W / 2, y + boxH / 2);
        ctx.textAlign = "left";
        y += boxH;
      }
      if (b.lines.length) drawLines(ctx, b, F.body, PAD, y + 36, p.muted, p, { lh: 1.35 });
      break;
    }
    case "cta": {
      const h = note(fit(ctx, slide.heading, F.heading, maxW, { max: 88, min: 48, maxLines: 5, lh: 1.1 }));
      const b = note(fit(ctx, slide.body, F.body, maxW, { max: 42, min: 30, maxLines: 3, lh: 1.35 }));
      const card = 190;
      let y = startY(h.height + (b.lines.length ? 36 + b.height : 0) + 70 + card) - 30;
      y = drawLines(ctx, h, F.heading, PAD, y, p.fg, p, { lh: 1.1 });
      if (b.lines.length) y = drawLines(ctx, b, F.body, PAD, y + 36, p.muted, p, { lh: 1.35 });
      y += 70;
      ctx.fillStyle = p.card;
      roundRect(ctx, PAD, y, maxW, card, 32);
      ctx.fill();
      const av = 120;
      if (assets.showAvatar) drawAvatar(ctx, assets, PAD + 36, y + (card - av) / 2, av, p);
      const tx = PAD + 36 + (assets.showAvatar ? av + 32 : 0);
      ctx.fillStyle = p.fg;
      ctx.font = F.heading(42);
      ctx.fillText(assets.name || "You", tx, y + (assets.handle ? 86 : 108));
      if (assets.handle) {
        ctx.font = F.body(32);
        ctx.fillStyle = p.muted;
        ctx.fillText(assets.handle, tx, y + 132);
      }
      // "Follow" pill on the right
      ctx.font = F.bodyBold(30);
      const label = "+ Follow";
      const pw = ctx.measureText(label).width + 56;
      const px = PAD + maxW - pw - 36;
      const py = y + (card - 64) / 2;
      ctx.fillStyle = p.accent;
      roundRect(ctx, px, py, pw, 64, 32);
      ctx.fill();
      ctx.fillStyle = featured && (design.theme === "bold" || design.theme === "gradient") ? design.accent : p.bg;
      if (Math.abs(luminance(ctx.fillStyle as string) - luminance(p.accent)) < 0.25) ctx.fillStyle = p.fg;
      ctx.fillText(label, px + 28, py + 43);
      break;
    }
  }

  // Footer: photo, name and handle; "Swipe →" on the cover, page number elsewhere.
  if (type !== "cta") {
    const fy = SLIDE_H - 150;
    let tx = PAD;
    if (assets.showAvatar) {
      drawAvatar(ctx, assets, PAD, fy, 72, p);
      tx += 72 + 22;
    }
    ctx.fillStyle = p.fg;
    ctx.font = F.bodyBold(34);
    ctx.fillText(assets.name, tx, fy + (assets.handle ? 32 : 48));
    if (assets.handle) {
      ctx.fillStyle = p.muted;
      ctx.font = F.body(28);
      ctx.fillText(assets.handle, tx, fy + 68);
    }
    ctx.font = F.bodyBold(30);
    if (type === "cover") {
      const label = "Swipe  →";
      const w = ctx.measureText(label).width + 56;
      const x = SLIDE_W - PAD - w;
      ctx.strokeStyle = p.fg;
      ctx.lineWidth = 3;
      roundRect(ctx, x, fy + 6, w, 60, 30);
      ctx.stroke();
      ctx.fillStyle = p.fg;
      ctx.fillText(label, x + 28, fy + 47);
    } else {
      const label = `${index + 1} / ${total}`;
      ctx.fillStyle = p.muted;
      ctx.fillText(label, SLIDE_W - PAD - ctx.measureText(label).width, fy + 46);
    }
  }

  // Progress bar along the bottom edge.
  ctx.fillStyle = rgba(p.fg.startsWith("#") ? p.fg : "#ffffff", 0.12);
  ctx.fillRect(0, SLIDE_H - 12, SLIDE_W, 12);
  ctx.fillStyle = p.accent;
  ctx.fillRect(0, SLIDE_H - 12, (SLIDE_W * (index + 1)) / total, 12);

  return { canvas, overflow };
}

// --- Assets, thumbnails, PDF --------------------------------------------------------------------

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = src;
  });
}

/** Make sure the design's fonts are downloaded before drawing (canvas won't wait for them). */
export async function ensureFonts(design: CarouselDesign) {
  const { heading, body } = CAROUSEL_FONTS[design.font] ?? CAROUSEL_FONTS.inter;
  const specs = [`700 64px "${heading}"`, `600 64px "${heading}"`, `400 32px "${body}"`, `600 32px "${body}"`];
  if (heading === "Playfair Display") specs.push(`italic 600 64px "Playfair Display"`);
  await Promise.all(specs.map((s) => document.fonts.load(s).catch(() => [])));
}

export function slideThumbnails(slides: CarouselSlide[], design: CarouselDesign, assets: SlideAssets, width = 360) {
  return slides.map((s, i) => {
    const { canvas, overflow } = drawSlide(s, i, slides.length, design, assets);
    const small = document.createElement("canvas");
    small.width = width;
    small.height = Math.round((width * SLIDE_H) / SLIDE_W);
    const g = small.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(canvas, 0, 0, small.width, small.height);
    return { src: small.toDataURL("image/jpeg", 0.88), overflow };
  });
}

const dataUrlToBytes = (d: string) => Uint8Array.from(atob(d.slice(d.indexOf(",") + 1)), (c) => c.charCodeAt(0));

/** Render all slides and pack them into a PDF data URL under the size limit. */
export async function buildCarouselPdf(slides: CarouselSlide[], title: string, design: CarouselDesign, assets: SlideAssets) {
  await ensureFonts(design);
  const canvases = slides.map((s, i) => drawSlide(s, i, slides.length, design, assets).canvas);
  for (const q of [0.88, 0.78, 0.66, 0.52, 0.4]) {
    const pages = canvases.map((c) => ({ jpeg: dataUrlToBytes(c.toDataURL("image/jpeg", q)), width: SLIDE_W, height: SLIDE_H }));
    const pdf = buildPdf(pages, title);
    if (pdf.length <= MAX_DOCUMENT_BYTES) {
      let bin = "";
      for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
      return `data:application/pdf;base64,${btoa(bin)}`;
    }
  }
  throw new Error("The carousel is too large. Try fewer slides or images.");
}

/** Resize a photo/screenshot for a slide: JPEG, longest side ≤ 1000px, under the size limit. */
export async function prepareSlideImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    for (const side of [1000, 800, 640, 520]) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.72, 0.6]) {
        const out = c.toDataURL("image/jpeg", q);
        if (Math.ceil(((out.length - out.indexOf(",") - 1) * 3) / 4) <= MAX_SLIDE_IMAGE_BYTES) return out;
      }
    }
    throw new Error("That image is too large even after compressing");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resize a logo to a small PNG (keeps transparency). */
export async function prepareLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 320 / img.naturalWidth, 160 / img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL("image/png");
    if (out.length > 200_000) throw new Error("Logo is too large; try a simpler image");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
