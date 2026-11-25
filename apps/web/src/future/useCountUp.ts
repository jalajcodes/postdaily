import { useEffect, useState } from "react";
import { isFuture, prefersReducedMotion } from "./theme";

/** Counts up to `target` in futuristic mode (eased, ~0.9 s); otherwise shows it right away. */
export function useCountUp(target: number) {
  const animate = isFuture() && !prefersReducedMotion();
  const [value, setValue] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) return setValue(target);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 900);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);
  return value;
}
