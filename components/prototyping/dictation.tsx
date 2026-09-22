"use client";

// Voice input for the brief editor — and only the brief editor.
//
// Two paths:
//   A. Live dictation with the browser's own SpeechRecognition. Free, no key.
//      Interim words appear in the editor as they are spoken.
//   B. A voice note: recorded here (or an existing audio file), sent to
//      /api/transcribe (Whisper on Groq) and returned as text. Used when the
//      browser has no speech engine, for uploaded files, and whenever the
//      speech language is Arabic — Whisper reads Arabic far more reliably.
//
// Either way the words land in the editor as ordinary editable text. Nothing
// is analysed automatically, audio is never kept, and the microphone is only
// requested when the client presses a button. A failure says what failed and
// leaves the existing text exactly as it was.

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Mic, Square, Upload, X } from "lucide-react";

import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  SPEECH_LANGS,
  appendText,
  whisperLang,
  type SpeechLang,
  type TranscribeError,
} from "@/lib/prototyping/voice";
import { GhostButton, SoftButton, selectClass } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";

// The Web Speech API is not in TypeScript's DOM lib; this is the part we use.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const canRecord = () =>
  typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

type Phase = "idle" | "live" | "recording" | "transcribing";
type Failure = "denied" | "noMic" | "noSpeech" | "live" | TranscribeError;

/** Microphone level, 0–1, for the recording indicator. */
function useLevel() {
  const [level, setLevel] = useState(0);
  const stopRef = useRef<() => void>(() => {});
  function watch(stream: MediaStream) {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      raf = requestAnimationFrame(tick);
    };
    tick();
    stopRef.current = () => {
      cancelAnimationFrame(raf);
      void ctx.close();
      setLevel(0);
    };
  }
  return { level, watch, unwatch: () => stopRef.current() };
}

function Meter({ level }: { level: number }) {
  // Five bars; how many light up follows the live input level.
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden>
      {[0.1, 0.25, 0.4, 0.6, 0.8].map((th, i) => (
        <span
          key={i}
          className={cn(
            "w-1 rounded-sm transition-colors",
            level > th ? "bg-destructive" : "bg-borderstrong"
          )}
          style={{ height: `${40 + i * 15}%` }}
        />
      ))}
    </span>
  );
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function Dictation({
  value,
  onChange,
  onBusy,
  onDone,
  projectId,
}: {
  /** For metering: which project the voice note is billed to. */
  projectId?: string;
  value: string;
  onChange: (value: string) => void;
  /** True while dictated text is streaming in, so the editor can go read-only. */
  onBusy: (busy: boolean) => void;
  /** Called after text was added, so the editor can take focus. */
  onDone: () => void;
}) {
  const t = useTranslations("Prototyping");
  const uiLocale = useLocale();
  const [lang, setLang] = useState<SpeechLang>(uiLocale === "ar" ? "ar-QA" : "en-US");
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Feature detection runs after mount so server and client render the same.
  const [support, setSupport] = useState<{ live: boolean; record: boolean } | null>(null);
  const { level, watch, unwatch } = useLevel();

  const valueRef = useRef(value);
  valueRef.current = value;
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSupport({ live: !!recognitionCtor(), record: canRecord() });
  }, []);

  useEffect(() => onBusy(phase === "live"), [phase, onBusy]);

  // Leaving the page mid-recording must release the microphone.
  useEffect(() => () => release(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function release() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    unwatch();
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }

  /** Asks for the microphone — only ever from a button press. */
  async function openMic(): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      watch(stream);
      const t0 = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Date.now() - t0), 250);
      return stream;
    } catch (e) {
      const name = (e as DOMException)?.name;
      setFailure(name === "NotFoundError" || name === "OverconstrainedError" ? "noMic" : "denied");
      return null;
    }
  }

  // Arabic goes to Whisper; so does everything when the browser has no engine.
  const useWhisper = lang.startsWith("ar") || !support?.live;

  // ── Path A: live dictation ────────────────────────────────────────────────
  async function startLive() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setFailure(null);
    if (!(await openMic())) return;

    const base = valueRef.current;
    let finals = "";
    let heard = false;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals = appendText(finals, r[0].transcript);
        else interim = appendText(interim, r[0].transcript);
      }
      heard = true;
      onChange(appendText(base, appendText(finals, interim)));
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      setFailure(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "denied"
          : e.error === "no-speech"
            ? "noSpeech"
            : e.error === "audio-capture"
              ? "noMic"
              : "live"
      );
    };
    rec.onend = () => {
      // Keep only what the engine settled on; unconfirmed interim words go.
      onChange(appendText(base, finals));
      if (!heard) setFailure((f) => f ?? "noSpeech");
      else setTimeout(onDone, 0);
      recRef.current = null;
      release();
      setPhase("idle");
    };
    recRef.current = rec;
    setPhase("live");
    rec.start();
  }

  // ── Path B: voice note → Whisper ──────────────────────────────────────────
  async function startRecording() {
    setFailure(null);
    const stream = await openMic();
    if (!stream) return;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      release();
      recorderRef.current = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      void transcribe(blob);
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setPhase("recording");
    setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_RECORDING_MS);
  }

  async function transcribe(audio: Blob, name?: string) {
    if (audio.size > MAX_AUDIO_BYTES) {
      setPhase("idle");
      return setFailure("too_large");
    }
    setPhase("transcribing");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const ext = (audio.type.split("/")[1] ?? "webm").split(";")[0];
    const body = new FormData();
    body.append("audio", audio, name ?? `voice-note.${ext}`);
    body.append("language", whisperLang(lang));
    if (projectId) body.append("projectId", projectId);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body, signal: ctrl.signal });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: TranscribeError };
      if (!res.ok || !data.text) setFailure(data.error ?? "failed");
      // Appended to whatever is in the editor NOW, so typing meanwhile is kept.
      else {
        onChange(appendText(valueRef.current, data.text));
        setTimeout(onDone, 0);
      }
    } catch {
      if (!ctrl.signal.aborted) setFailure("failed");
    }
    abortRef.current = null;
    setPhase("idle");
  }

  function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setFailure(null);
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) return setFailure("not_audio");
    void transcribe(file, file.name);
  }

  function stop() {
    if (phase === "live") recRef.current?.stop();
    if (phase === "recording") recorderRef.current?.stop();
  }

  if (!support) return null;
  const micAvailable = useWhisper ? support.record : support.live;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {phase === "idle" && (
          <>
            {/* Hidden entirely, not disabled, where the browser can't do it. */}
            {micAvailable && (
              <SoftButton onClick={useWhisper ? startRecording : startLive} className="bg-surface">
                <Mic className="h-3.5 w-3.5" />
                {t(useWhisper ? "voiceRecord" : "voiceDictate")}
              </SoftButton>
            )}
            <GhostButton onClick={() => fileRef.current?.click()} className="px-2">
              <Upload className="h-3.5 w-3.5" />
              {t("voiceUpload")}
            </GhostButton>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <label className="ms-auto inline-flex items-center gap-1.5 text-[11px] text-mutedtext">
              {t("voiceLanguage")}
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as SpeechLang)}
                className={cn(selectClass, "py-1 text-[12px]")}
              >
                {SPEECH_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {t(`voiceLang_${l.slice(0, 2)}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {(phase === "live" || phase === "recording") && (
          <div
            role="status"
            className="flex w-full items-center gap-3 rounded-xl bg-destructive/10 px-3 py-2 text-[12px] font-semibold text-destructive"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
            <Meter level={level} />
            <span className="min-w-0 flex-1 tabular-nums">
              {phase === "live" ? t("voiceListening") : t("voiceRecording", { time: clock(elapsed) })}
            </span>
            <SoftButton onClick={stop} className="bg-surface text-heading">
              <Square className="h-3 w-3" />
              {t("voiceStop")}
            </SoftButton>
          </div>
        )}

        {phase === "transcribing" && (
          <div
            role="status"
            className="flex w-full items-center gap-3 rounded-xl bg-panel px-3 py-2 text-[12px] font-semibold text-heading shadow-neu-inset"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cobalt" />
            <span className="min-w-0 flex-1">{t("voiceTranscribing")}</span>
            <GhostButton onClick={() => abortRef.current?.abort()} className="px-2">
              <X className="h-3.5 w-3.5" />
              {t("voiceCancel")}
            </GhostButton>
          </div>
        )}
      </div>

      {failure && (
        <p role="alert" className="text-[11.5px] font-medium text-destructive">
          {t(`voiceErr_${failure}`)}
        </p>
      )}
      <p className="text-[10.5px] leading-relaxed text-faint">
        {t(useWhisper ? "voiceNoteHint" : "voiceLiveHint")}
      </p>
    </div>
  );
}
