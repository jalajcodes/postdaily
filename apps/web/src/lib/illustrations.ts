// Line-art illustrations for carousel backgrounds. The artwork is from the Lucide icon set
// (ISC license, already bundled via lucide-react); only these icons are imported.
import type { CarouselIllustration } from "@postdaily/shared";
import * as i_rocket from "lucide-react/icons/rocket";
import * as i_lightbulb from "lucide-react/icons/lightbulb";
import * as i_trending_up from "lucide-react/icons/trending-up";
import * as i_chart_column from "lucide-react/icons/chart-column";
import * as i_target from "lucide-react/icons/target";
import * as i_megaphone from "lucide-react/icons/megaphone";
import * as i_mountain from "lucide-react/icons/mountain";
import * as i_sparkles from "lucide-react/icons/sparkles";
import * as i_brain from "lucide-react/icons/brain";
import * as i_handshake from "lucide-react/icons/handshake";
import * as i_coffee from "lucide-react/icons/coffee";
import * as i_briefcase from "lucide-react/icons/briefcase";
import * as i_users from "lucide-react/icons/users";
import * as i_compass from "lucide-react/icons/compass";
import * as i_trophy from "lucide-react/icons/trophy";
import * as i_flame from "lucide-react/icons/flame";
import * as i_zap from "lucide-react/icons/zap";
import * as i_heart from "lucide-react/icons/heart";
import * as i_message_circle from "lucide-react/icons/message-circle";
import * as i_pen_tool from "lucide-react/icons/pen-tool";
import * as i_code_xml from "lucide-react/icons/code-xml";
import * as i_puzzle from "lucide-react/icons/puzzle";
import * as i_palette from "lucide-react/icons/palette";
import * as i_globe from "lucide-react/icons/globe";
import * as i_leaf from "lucide-react/icons/leaf";

type Shape = [tag: string, attrs: Record<string, string | number>];

/** lucide-react keeps each icon's SVG shapes on `__iconData` (not in its public types). */
function shapes(mod: unknown): Shape[] {
  const node = (mod as { __iconData?: { node?: unknown } }).__iconData?.node;
  return Array.isArray(node) ? (node as Shape[]) : [];
}

const ICONS: Record<Exclude<CarouselIllustration, "none">, Shape[]> = {
  "rocket": shapes(i_rocket),
  "lightbulb": shapes(i_lightbulb),
  "trending-up": shapes(i_trending_up),
  "chart-column": shapes(i_chart_column),
  "target": shapes(i_target),
  "megaphone": shapes(i_megaphone),
  "mountain": shapes(i_mountain),
  "sparkles": shapes(i_sparkles),
  "brain": shapes(i_brain),
  "handshake": shapes(i_handshake),
  "coffee": shapes(i_coffee),
  "briefcase": shapes(i_briefcase),
  "users": shapes(i_users),
  "compass": shapes(i_compass),
  "trophy": shapes(i_trophy),
  "flame": shapes(i_flame),
  "zap": shapes(i_zap),
  "heart": shapes(i_heart),
  "message-circle": shapes(i_message_circle),
  "pen-tool": shapes(i_pen_tool),
  "code-xml": shapes(i_code_xml),
  "puzzle": shapes(i_puzzle),
  "palette": shapes(i_palette),
  "globe": shapes(i_globe),
  "leaf": shapes(i_leaf),
};

export const ILLUSTRATION_IDS = Object.keys(ICONS) as Exclude<CarouselIllustration, "none">[];

const num = (v: string | number | undefined) => Number(v ?? 0);

/** Draw an icon (24x24 artwork) with its top-left at (x, y), `size` px wide, as outlined line art. */
export function drawIllustration(
  ctx: CanvasRenderingContext2D,
  id: CarouselIllustration | undefined,
  x: number,
  y: number,
  size: number,
  color: string,
  { strokeWidth = 1.5, rotate = 0 }: { strokeWidth?: number; rotate?: number } = {},
) {
  if (!id || id === "none") return false;
  const parts = ICONS[id];
  if (!parts?.length) return false;
  const k = size / 24;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  if (rotate) ctx.rotate(rotate);
  ctx.translate(-size / 2, -size / 2);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [tag, a] of parts) {
    const path = new Path2D();
    if (tag === "path" && typeof a.d === "string") path.addPath(new Path2D(a.d));
    else if (tag === "circle") path.arc(num(a.cx), num(a.cy), num(a.r), 0, Math.PI * 2);
    else if (tag === "ellipse") path.ellipse(num(a.cx), num(a.cy), num(a.rx), num(a.ry), 0, 0, Math.PI * 2);
    else if (tag === "rect") path.roundRect(num(a.x), num(a.y), num(a.width), num(a.height), num(a.rx));
    else if (tag === "line") {
      path.moveTo(num(a.x1), num(a.y1));
      path.lineTo(num(a.x2), num(a.y2));
    } else if (tag === "polyline" || tag === "polygon") {
      const pts = String(a.points ?? "").trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < pts.length; i += 2) (i ? path.lineTo(pts[i], pts[i + 1]) : path.moveTo(pts[i], pts[i + 1]));
      if (tag === "polygon") path.closePath();
    } else continue;
    ctx.stroke(path);
  }
  ctx.restore();
  return true;
}

/** Number of shapes per icon (for tests: every illustration must have artwork). */
export const illustrationShapeCount = (id: Exclude<CarouselIllustration, "none">) => ICONS[id]?.length ?? 0;
