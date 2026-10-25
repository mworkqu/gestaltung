// Browser globals that TypeScript's DOM lib does not declare: vendor-prefixed
// APIs and the test hooks the e2e specs read. A script file (no imports or
// exports), so every interface below merges into the global one.

/** The part of the Web Speech API components/prototyping/dictation.tsx uses. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface Window {
  // Web Speech API (Chromium exposes the webkit-prefixed name).
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  // Safari before 14.1 only has the prefixed AudioContext.
  webkitAudioContext?: typeof AudioContext;

  // e2e hooks, set only by the studio fixture / mock pages.
  /** How many times the mocked model was asked (components/studio/StudioFixture.tsx). */
  __g360Ai?: { spec: number; pick: number };
  /** The last quote request the mock studio API received (lib/studio/client/mock.ts). */
  __g360LastQuote?: unknown;
  /** Screen position of each wiring part (components/studio/steps/wiring/Wiring3DView.tsx). */
  __wiring3dParts?: () => { id: string; board: boolean; size: number; x: number; y: number }[];
  /** Orbit camera distance and limits (Wiring3DView.tsx). */
  __wiring3dCamera?: () => { dist: number; min: number; max: number };
}
