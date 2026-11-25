// A neon particle burst (plain canvas, no dependencies). Only runs in futuristic mode.
import { isFuture, prefersReducedMotion } from "./theme";

const COLORS = ["#22d3ee", "#67e8f9", "#818cf8", "#a855f7", "#f0abfc", "#fde047"];

/** Burst from a point (defaults to the focused button, else the screen center). */
export function celebrate(origin?: { x: number; y: number }) {
  if (!isFuture() || prefersReducedMotion()) return;
  let { x, y } = origin ?? { x: innerWidth / 2, y: innerHeight / 2 };
  if (!origin && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    const r = document.activeElement.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const canvas = document.createElement("canvas");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "60" });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const parts = Array.from({ length: 90 }, () => {
    const a = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    return {
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 3,
      r: 1.5 + Math.random() * 2.5,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      spin: Math.random() < 0.3,
    };
  });
  const ring = { r: 0, a: 1 };
  const start = performance.now();
  const frame = (now: number) => {
    const t = (now - start) / 1000;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = "lighter";
    // Expanding shock ring
    ring.r += 14;
    ring.a = Math.max(0, 1 - t * 2.2);
    ctx.strokeStyle = `rgba(103,232,249,${ring.a * 0.8})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, ring.r, 0, Math.PI * 2);
    ctx.stroke();
    for (const p of parts) {
      p.vy += 0.18;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      const alpha = Math.max(0, 1 - t / 1.4);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      g.addColorStop(0, p.c);
      g.addColorStop(1, "transparent");
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
      ctx.fill();
      if (p.spin) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    if (t < 1.5) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
