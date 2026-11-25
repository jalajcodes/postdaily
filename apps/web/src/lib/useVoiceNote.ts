import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { LIVE_UNAVAILABLE, recordingSupported, speechSupported, startDictation, startRecording } from "./speech";

type Mode = "live" | "record";
type State = "idle" | "listening" | "recording" | "transcribing";
const MODE_KEY = "postdaily.voiceMode";

const savedMode = (): Mode | null => {
  try {
    return localStorage.getItem(MODE_KEY) as Mode | null;
  } catch {
    return null;
  }
};

/**
 * Voice notes. Uses the browser's live dictation when it works (words appear as you speak).
 * Where it doesn't (Brave, Arc, Firefox, in-app browsers), it records and transcribes on the
 * server instead, and remembers that choice for next time.
 */
export function useVoiceNote(onText: (text: string) => void) {
  const [mode, setMode] = useState<Mode>(() => savedMode() ?? (speechSupported() ? "live" : "record"));
  const [state, setState] = useState<State>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const stopLive = useRef<(() => void) | null>(null);
  const recorder = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  useEffect(
    () => () => {
      stopLive.current?.();
      recorder.current?.cancel();
      if (tick.current) clearInterval(tick.current);
    },
    [],
  );

  const supported = speechSupported() || recordingSupported();

  async function record() {
    setError(null);
    try {
      recorder.current = await startRecording(() => void finishRecording());
    } catch (e) {
      setState("idle");
      setError((e as Error).message);
      return;
    }
    setSeconds(0);
    tick.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    setState("recording");
  }

  async function finishRecording() {
    if (tick.current) clearInterval(tick.current);
    const rec = recorder.current;
    recorder.current = null;
    if (!rec) return;
    setState("transcribing");
    try {
      const audio = await rec.stop();
      const { text } = await api.ai.transcribe(audio);
      if (text) textRef.current(text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setState("idle");
    }
  }

  function live() {
    setError(null);
    setState("listening");
    stopLive.current = startDictation(
      (finalText, guess) => {
        if (finalText) textRef.current(finalText.trim());
        setInterim(guess);
      },
      (err, code) => {
        setInterim("");
        if (code && (LIVE_UNAVAILABLE.includes(code) || code === "unsupported") && recordingSupported()) {
          // Live dictation can't work here: switch to recording for good, and start now.
          setMode("record");
          try {
            localStorage.setItem(MODE_KEY, "record");
          } catch {}
          setNotice("Live dictation isn't available in this browser, so PostDaily records your voice note and turns it into text when you tap Stop.");
          void record();
          return;
        }
        setState("idle");
        if (err) setError(err);
      },
    );
  }

  function toggle() {
    if (state === "transcribing") return;
    if (state === "listening") return stopLive.current?.();
    if (state === "recording") return void finishRecording();
    setNotice(null);
    if (mode === "live" && speechSupported()) live();
    else if (recordingSupported()) void record();
    else setError("This browser can't record audio. Try your keyboard's mic button instead.");
  }

  return { supported, mode, state, interim, error, notice, seconds, toggle };
}
