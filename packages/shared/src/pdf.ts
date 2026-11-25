// A tiny PDF writer: one full-page JPEG per page. Enough for LinkedIn document
// carousels, with no dependency (works in the browser, Node and React Native).

export interface PdfPage {
  /** JPEG file bytes. */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
}

/** Build a PDF where each page shows one JPEG edge to edge. Pages are sized at 72 dpi / 2. */
export function buildPdf(pages: PdfPage[], title = ""): Uint8Array {
  if (!pages.length) throw new Error("A PDF needs at least one page");
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  // Object numbers: 1 catalog, 2 page tree, 3 info, then 3 per page (page, content, image).
  const pageObj = (i: number) => 4 + i * 3;
  const startObj = (n: number) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  startObj(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObj(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>\nendobj\n`);
  startObj(3);
  push(`<< /Title (${pdfString(title)}) /Producer (PostDaily) >>\nendobj\n`);

  pages.forEach((p, i) => {
    const w = Math.round(p.width / 2);
    const h = Math.round(p.height / 2);
    const n = pageObj(i);
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    startObj(n);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>\nendobj\n`,
    );
    startObj(n + 1);
    push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`);
    startObj(n + 2);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
    );
    push(p.jpeg);
    push("\nendstream\nendobj\n");
  });

  const count = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Escape a PDF literal string; non-ASCII characters are dropped (title is metadata only). */
function pdfString(s: string) {
  return s.replace(/[^\x20-\x7E]/g, "").replace(/[\\()]/g, (c) => `\\${c}`);
}
