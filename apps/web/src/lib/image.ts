import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, buildPdf, type CarouselSlide } from "@postdaily/shared";

const dataUrlBytes = (d: string) => Math.ceil(((d.length - d.indexOf(",") - 1) * 3) / 4);

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = src;
  });
}

/** Resize/compress to a JPEG under MAX_IMAGE_BYTES (longest side ≤ 1600px). */
export async function prepareImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let maxSide = 1600;
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff"; // flatten transparency
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.88, 0.78, 0.68]) {
        const out = canvas.toDataURL("image/jpeg", q);
        if (dataUrlBytes(out) <= MAX_IMAGE_BYTES) return out;
      }
      maxSide = Math.round(maxSide * 0.75);
    }
    throw new Error("Image is too large even after compressing");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** A 1080×1080 quote card from the post's opening lines. */
export function quoteCard(text: string, name: string): string {
  const S = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, "#0a66c2");
  grad.addColorStop(1, "#074a8d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.font = "bold 260px Georgia, serif";
  ctx.fillText("“", 70, 280);

  // Fit the text: shrink the font until it fits in the card.
  // The hook: the first few lines, cut at a word boundary.
  let quote = text.trim().split("\n").filter(Boolean).slice(0, 4).join("\n");
  if (quote.length > 220) quote = `${quote.slice(0, 220).replace(/\s+\S*$/, "").replace(/[,;:.\s]+$/, "")}…`;
  let size = 64;
  let lines: string[] = [];
  for (; size >= 34; size -= 4) {
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    lines = wrap(ctx, quote, S - 220);
    if (lines.length * size * 1.3 <= S - 420) break;
  }
  ctx.fillStyle = "#fff";
  const total = lines.length * size * 1.3;
  let y = (S - total) / 2 + size;
  for (const line of lines) {
    ctx.fillText(line, 110, y);
    y += size * 1.3;
  }

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "500 36px Inter, system-ui, sans-serif";
  ctx.fillText(`— ${name}`, 110, S - 110);
  return canvas.toDataURL("image/jpeg", 0.9);
}

// --- PDF carousels ---------------------------------------------------------------------

/** LinkedIn's best-performing document shape: 4:5 portrait. */
export const SLIDE_W = 1080;
export const SLIDE_H = 1350;

/** Draw one carousel slide. Cover (first) and closing (last) slides get the blue theme. */
export function drawSlide(slide: CarouselSlide, index: number, total: number, name: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W;
  canvas.height = SLIDE_H;
  const ctx = canvas.getContext("2d")!;
  const accent = index === 0 || index === total - 1;
  const fg = accent ? "#ffffff" : "#0f172a";
  const muted = accent ? "rgba(255,255,255,0.75)" : "#64748b";

  if (accent) {
    const grad = ctx.createLinearGradient(0, 0, SLIDE_W, SLIDE_H);
    grad.addColorStop(0, "#0a66c2");
    grad.addColorStop(1, "#074a8d");
    ctx.fillStyle = grad;
  } else ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  if (!accent) {
    ctx.fillStyle = "#0a66c2";
    ctx.fillRect(0, 0, SLIDE_W, 14);
  }

  const pad = 110;
  const maxW = SLIDE_W - pad * 2;
  // Heading: biggest size that fits in at most 5 lines.
  let hSize = index === 0 ? 96 : 76;
  let hLines: string[] = [];
  for (; hSize >= 44; hSize -= 4) {
    ctx.font = `700 ${hSize}px Inter, system-ui, sans-serif`;
    hLines = wrap(ctx, slide.heading, maxW);
    if (hLines.length <= 5) break;
  }
  let bSize = 44;
  let bLines: string[] = [];
  for (; bSize >= 28; bSize -= 2) {
    ctx.font = `400 ${bSize}px Inter, system-ui, sans-serif`;
    bLines = slide.body.trim() ? wrap(ctx, slide.body, maxW) : [];
    if (bLines.length * bSize * 1.4 <= 560) break;
  }

  const hHeight = hLines.length * hSize * 1.15;
  const bHeight = bLines.length * bSize * 1.4;
  const gap = bLines.length ? 48 : 0;
  let y = Math.max(220, (SLIDE_H - hHeight - gap - bHeight) / 2) + hSize;

  ctx.fillStyle = fg;
  ctx.font = `700 ${hSize}px Inter, system-ui, sans-serif`;
  for (const line of hLines) {
    ctx.fillText(line, pad, y);
    y += hSize * 1.15;
  }
  y += gap - hSize * 0.15;
  ctx.fillStyle = accent ? "rgba(255,255,255,0.9)" : "#334155";
  ctx.font = `400 ${bSize}px Inter, system-ui, sans-serif`;
  for (const line of bLines) {
    y += bSize;
    ctx.fillText(line, pad, y);
    y += bSize * 0.4;
  }

  // Footer: author and page number; "Swipe →" on the cover.
  ctx.font = "500 32px Inter, system-ui, sans-serif";
  ctx.fillStyle = muted;
  ctx.fillText(name, pad, SLIDE_H - 90);
  const right = index === 0 ? "Swipe →" : `${index + 1} / ${total}`;
  ctx.fillText(right, SLIDE_W - pad - ctx.measureText(right).width, SLIDE_H - 90);
  return canvas;
}

/** Small preview images of the slides (data URLs). */
export function slideThumbnails(slides: CarouselSlide[], name: string, width = 360): string[] {
  return slides.map((s, i) => {
    const full = drawSlide(s, i, slides.length, name);
    const small = document.createElement("canvas");
    small.width = width;
    small.height = Math.round((width * SLIDE_H) / SLIDE_W);
    small.getContext("2d")!.drawImage(full, 0, 0, small.width, small.height);
    return small.toDataURL("image/jpeg", 0.85);
  });
}

const dataUrlToBytes = (d: string) => Uint8Array.from(atob(d.slice(d.indexOf(",") + 1)), (c) => c.charCodeAt(0));

/** Render the slides and pack them into a PDF data URL that fits the size limit. */
export async function buildCarouselPdf(slides: CarouselSlide[], title: string, name: string): Promise<string> {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvases = slides.map((s, i) => drawSlide(s, i, slides.length, name));
  for (const q of [0.85, 0.75, 0.6, 0.45]) {
    const pages = canvases.map((c) => ({ jpeg: dataUrlToBytes(c.toDataURL("image/jpeg", q)), width: SLIDE_W, height: SLIDE_H }));
    const pdf = buildPdf(pages, title);
    if (pdf.length <= MAX_DOCUMENT_BYTES) {
      let bin = "";
      for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
      return `data:application/pdf;base64,${btoa(bin)}`;
    }
  }
  throw new Error("The carousel is too large. Try fewer slides.");
}
