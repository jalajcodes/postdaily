// Voice dictation with the browser's built-in speech recognition (Chrome, Edge, Safari).
// Audio is handled by the browser / OS, not by PostDaily.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const Ctor = (): (new () => Recognition) | undefined =>
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const speechSupported = () => typeof window !== "undefined" && !!Ctor();

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser's site settings.",
  "service-not-allowed": "Dictation isn't available here. Try your keyboard's mic button instead.",
  "no-speech": "Didn't hear anything. Try again.",
  network: "Dictation needs an internet connection.",
};

/**
 * Start dictating. `onText(finalText, interimText)` is called as you speak: final text is
 * settled, interim text is the current guess. Returns a stop function.
 */
export function startDictation(
  onText: (finalText: string, interim: string) => void,
  onEnd: (error?: string) => void,
): () => void {
  const R = Ctor();
  if (!R) {
    onEnd("This browser doesn't support dictation. Try your keyboard's mic button instead.");
    return () => {};
  }
  const rec = new R();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  let error: string | undefined;
  rec.onresult = (e) => {
    let finalText = "";
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText(finalText, interim);
  };
  rec.onerror = (e) => {
    if (e.error !== "aborted") error = ERRORS[e.error] ?? `Dictation stopped (${e.error}).`;
  };
  rec.onend = () => onEnd(error);
  rec.start();
  return () => rec.stop();
}
