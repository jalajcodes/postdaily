import { MAX_IMAGE_BYTES } from "@postdaily/shared";

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
