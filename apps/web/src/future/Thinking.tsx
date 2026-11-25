// "AI is thinking" animation (Lottie). Shown in futuristic mode while drafts, plans or
// carousels are being written. lottie-web's light SVG player is lazy-loaded with this file.
import { useEffect, useRef } from "react";
import lottie from "lottie-web/build/player/lottie_light";
import animationData from "./thinking.json";
import { prefersReducedMotion } from "./theme";

export default function Thinking({ label }: { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anim = lottie.loadAnimation({
      container: ref.current!,
      renderer: "svg",
      loop: true,
      autoplay: !prefersReducedMotion(),
      animationData,
    });
    return () => anim.destroy();
  }, []);
  return (
    <div className="mt-6 flex flex-col items-center gap-1 text-center">
      <div ref={ref} className="size-24" aria-hidden />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}
