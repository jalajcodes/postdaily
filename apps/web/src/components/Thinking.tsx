import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const LottieThinking = lazy(() => import("../future/Thinking"));

/** "Working on it…" note: a plain line normally, an animated Lottie in futuristic mode. */
export function ThinkingNote({ label }: { label: string }) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const plain = <p className="mt-6 text-center text-sm text-slate-500">{label}</p>;
  if (!settings.data?.futuristic) return plain;
  return (
    <Suspense fallback={plain}>
      <LottieThinking label={label} />
    </Suspense>
  );
}
