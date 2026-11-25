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
  network: "Live dictation isn't available in this browser.",
};

/**
 * Start dictating. `onText(finalText, interimText)` is called as you speak: final text is
 * settled, interim text is the current guess. Returns a stop function.
 */
export function startDictation(
  onText: (finalText: string, interim: string) => void,
  onEnd: (error?: string, code?: string) => void,
): () => void {
  const R = Ctor();
  if (!R) {
    onEnd("This browser doesn't support dictation. Try your keyboard's mic button instead.", "unsupported");
    return () => {};
  }
  const rec = new R();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  let error: string | undefined;
  let code: string | undefined;
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
    if (e.error !== "aborted") {
      code = e.error;
      error = ERRORS[e.error] ?? `Dictation stopped (${e.error}).`;
    }
  };
  rec.onend = () => onEnd(error, code);
  rec.start();
  return () => rec.stop();
}

// --- Fallback: record, then transcribe on the server ------------------------------------------

/** Errors that mean live dictation can't work in this browser (not a one-off hiccup). */
export const LIVE_UNAVAILABLE = ["network", "service-not-allowed", "language-not-supported"];
export const MAX_RECORDING_MS = 4 * 60_000;

export const recordingSupported = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

/**
 * Start recording from the mic. Resolves once recording has started; `stop()` resolves with
 * the audio. Stops by itself after MAX_RECORDING_MS.
 */
export async function startRecording(onAutoStop: () => void): Promise<{ stop: () => Promise<Blob>; cancel: () => void }> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const name = (e as DOMException).name;
    throw new Error(
      name === "NotAllowedError"
        ? "Microphone access was blocked. Allow it in your browser's site settings."
        : name === "NotFoundError"
          ? "No microphone found."
          : `Couldn't start the microphone (${name}).`,
    );
  }
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: (rec.mimeType || mimeType || "audio/webm").split(";")[0] }));
    };
  });
  rec.start(1000);
  const timer = setTimeout(() => {
    if (rec.state !== "inactive") {
      rec.stop();
      onAutoStop();
    }
  }, MAX_RECORDING_MS);
  return {
    stop: () => {
      clearTimeout(timer);
      if (rec.state !== "inactive") rec.stop();
      return done;
    },
    cancel: () => {
      clearTimeout(timer);
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
