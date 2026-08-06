// Voice input via the browser-native Web Speech API
// (`SpeechRecognition`/`webkitSpeechRecognition`). Client-only — no server
// round-trip, no dependency, no wire-shape change. Speech recognition only
// runs in a secure context (HTTPS or localhost), so over plain-HTTP Tailscale
// the mic is unavailable; callers feature-detect via `speechSupported()` and
// simply hide the control.
import { useCallback, useEffect, useRef, useState } from "react";

// Minimal shape of the Web Speech API — it is not in the TS DOM lib. Only the
// slice we touch is declared; everything else is left off deliberately.
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return getCtor() !== null && window.isSecureContext;
}

export interface Dictation {
  supported: boolean;
  listening: boolean;
  // Live, not-yet-finalized words, for a transient preview under the composer.
  interim: string;
  error: string | null;
  toggle: () => void;
  stop: () => void;
}

// Dictation hook: `onFinal` receives each finalized chunk (the caller appends
// it to the composer). Recognition often ends on its own after a pause —
// especially on mobile Safari, which ignores `continuous` — so while the user
// still wants to listen we restart it, yielding continuous hands-free dictation.
export function useDictation(onFinal: (text: string) => void): Dictation {
  const [supported] = useState(speechSupported);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const wantListening = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    wantListening.current = false;
    setListening(false);
    setInterim("");
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText) onFinalRef.current(finalText);
      setInterim(interimText);
    };
    rec.onerror = (event) => {
      // "no-speech"/"aborted" are benign end conditions; only real failures
      // (mic permission denied, service unavailable) surface to the user.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(event.error === "not-allowed" ? "Microphone permission denied" : event.error);
        wantListening.current = false;
      }
    };
    rec.onend = () => {
      setInterim("");
      if (wantListening.current) {
        try {
          rec.start();
        } catch {
          // A double-start can throw; treat it as a stop.
          wantListening.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };
    recognition.current = rec;
    wantListening.current = true;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      wantListening.current = false;
      setError((err as Error).message);
    }
  }, []);

  const toggle = useCallback(() => {
    if (wantListening.current) stop();
    else start();
  }, [start, stop]);

  // Tear down on unmount so a live recognizer never outlives the view.
  useEffect(() => {
    return () => {
      wantListening.current = false;
      recognition.current?.abort();
    };
  }, []);

  return { supported, listening, interim, error, toggle, stop };
}
