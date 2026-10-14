"use client";

// Lesson video player (Prompt 9 Step D).
// - Asks GET /api/cad-champions/video/<ref> for the embed URL: the server
//   checks access and signs Bunny links (2 h); nothing secret reaches here.
// - Responsive 16:9 iframe, speed buttons, resume from cc_lesson_progress.
// - Progress ping every 15 s while the position moves (server action), the
//   lesson completes at 90 % watched, "Mark as complete" fallback.
// Player APIs, both by postMessage (no third-party script):
//   YouTube: {"event":"listening"} -> infoDelivery {currentTime, duration};
//            {"event":"command","func":"seekTo"|"setPlaybackRate"}.
//   Bunny Stream: player.js protocol {"context":"player.js", method, value}
//            -> events "ready" / "timeupdate" {seconds, duration};
//            setCurrentTime is standard. Playback speed is not part of
//            player.js, so we send "setPlaybackRate" and also tell the
//            student the player's own menu has a speed setting.

import * as React from "react";
import { CheckCircle2, Film } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button, HelpTip, Spinner, useToast } from "@/components/cad-champions/ui";
import { WATCHED_THRESHOLD, watchedFraction } from "@/lib/cad-champions/videos/registry";
import { markLessonCompleteAction, saveLessonProgressAction } from "@/lib/cad-champions/training/actions";
import { cn } from "@/lib/utils";

const PING_MS = 15_000;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

type Source = { embedUrl: string; provider: "youtube" | "bunny" };
type State = { kind: "loading" } | { kind: "ready"; src: Source } | { kind: "none" } | { kind: "not_configured" } | { kind: "error" };

function fmtTime(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function LessonPlayer({
  slug,
  title,
  slot,
  resumeSecond,
  completed: initialCompleted,
  className,
}: {
  slug: string;
  title: string;
  /** Chosen slot (video-pick.ts), null = nothing recorded. */
  slot: string | null;
  resumeSecond: number;
  completed: boolean;
  className?: string;
}) {
  const t = useTranslations("CC.training.player");
  const router = useRouter();
  const toast = useToast();
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [state, setState] = React.useState<State>(slot ? { kind: "loading" } : { kind: "none" });
  const [speed, setSpeed] = React.useState<number>(1);
  const [completed, setCompleted] = React.useState(initialCompleted);
  const [marking, startMarking] = React.useTransition();
  const [resumed, setResumed] = React.useState(false);

  const pos = React.useRef({ time: 0, duration: 0, lastSent: -1 });
  const completedRef = React.useRef(initialCompleted);

  // 1. Get the embed URL (access checked on the server).
  React.useEffect(() => {
    if (!slot) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/cad-champions/video/${encodeURIComponent(`lesson:${slug}:${slot}`)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { embedUrl?: string; provider?: string; error?: string };
        if (!alive) return;
        if (res.ok && body.embedUrl && (body.provider === "youtube" || body.provider === "bunny")) {
          let url = body.embedUrl;
          if (body.provider === "youtube") {
            const u = new URL(url);
            u.searchParams.set("origin", window.location.origin);
            if (resumeSecond > 5 && !initialCompleted) u.searchParams.set("start", String(Math.floor(resumeSecond)));
            url = u.toString();
          }
          setState({ kind: "ready", src: { embedUrl: url, provider: body.provider } });
        } else if (res.status === 409) setState({ kind: "none" });
        else if (res.status === 503) setState({ kind: "not_configured" });
        else setState({ kind: "error" });
      } catch {
        if (alive) setState({ kind: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, slot, resumeSecond, initialCompleted]);

  const origin = state.kind === "ready" ? new URL(state.src.embedUrl).origin : null;
  const provider = state.kind === "ready" ? state.src.provider : null;

  const post = React.useCallback(
    (msg: unknown) => {
      if (!origin) return;
      frameRef.current?.contentWindow?.postMessage(JSON.stringify(msg), origin);
    },
    [origin]
  );

  const sendProgress = React.useCallback(
    async (force = false) => {
      const { time, duration, lastSent } = pos.current;
      if (!force && (time <= 0 || Math.abs(time - lastSent) < 1)) return;
      pos.current.lastSent = time;
      try {
        const res = await saveLessonProgressAction({ slug, second: time, duration });
        if (res.ok && res.justCompleted && !completedRef.current) {
          completedRef.current = true;
          setCompleted(true);
          toast.success(t("completedToast"));
          router.refresh();
        }
      } catch (e) {
        console.error("[cc-player] progress ping failed:", e instanceof Error ? e.message : e);
      }
    },
    [slug, router, toast, t]
  );

  // 2. Listen to the player.
  React.useEffect(() => {
    if (!origin || !provider) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return;
      let data: unknown;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      const d = data as Record<string, unknown>;
      let current: number | null = null;
      let duration: number | null = null;
      if (provider === "youtube") {
        const info = d.info as { currentTime?: unknown; duration?: unknown } | undefined;
        if (info && typeof info.currentTime === "number") current = info.currentTime;
        if (info && typeof info.duration === "number" && info.duration > 0) duration = info.duration;
      } else if (d.context === "player.js") {
        if (d.event === "ready") {
          post({ context: "player.js", version: "0.0.11", method: "addEventListener", value: "timeupdate", listener: "cc-time" });
          if (resumeSecond > 5 && !completedRef.current) {
            post({ context: "player.js", version: "0.0.11", method: "setCurrentTime", value: resumeSecond });
            setResumed(true);
          }
        }
        if (d.event === "timeupdate" && d.value && typeof d.value === "object") {
          const v = d.value as { seconds?: unknown; duration?: unknown };
          if (typeof v.seconds === "number") current = v.seconds;
          if (typeof v.duration === "number" && v.duration > 0) duration = v.duration;
        }
      }
      if (duration != null) pos.current.duration = duration;
      if (current != null) {
        pos.current.time = current;
        if (!completedRef.current && watchedFraction(current, pos.current.duration) >= WATCHED_THRESHOLD) void sendProgress(true);
      }
    }
    window.addEventListener("message", onMessage);
    const timer = window.setInterval(() => void sendProgress(), PING_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
      void sendProgress();
    };
  }, [origin, provider, post, resumeSecond, sendProgress]);

  function onFrameLoad() {
    if (provider === "youtube") {
      post({ event: "listening", id: slug, channel: "widget" });
      if (resumeSecond > 5 && !initialCompleted) setResumed(true);
    }
  }

  function changeSpeed(s: number) {
    setSpeed(s);
    if (provider === "youtube") post({ event: "command", func: "setPlaybackRate", args: [s] });
    if (provider === "bunny") post({ context: "player.js", version: "0.0.11", method: "setPlaybackRate", value: s });
  }

  function markComplete() {
    startMarking(async () => {
      const res = await markLessonCompleteAction({ slug, locale: document.documentElement.lang });
      if (res.ok) {
        completedRef.current = true;
        setCompleted(true);
        toast.success(t("completedToast"));
        router.refresh();
      } else toast.error(t("saveError"));
    });
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="neu-inset relative aspect-video w-full overflow-hidden rounded-2xl">
        {state.kind === "ready" ? (
          <iframe
            ref={frameRef}
            src={state.src.embedUrl}
            title={t("label", { title })}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            onLoad={onFrameLoad}
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {state.kind === "loading" ? (
              <Spinner label={t("loading")} />
            ) : (
              <>
                <Film aria-hidden="true" strokeWidth={1.5} className="h-10 w-10 text-mutedtext" />
                <p className="max-w-md text-base font-bold text-ink">
                  {state.kind === "error" ? t("error") : state.kind === "not_configured" ? t("notConfigured") : t("comingSoon")}
                </p>
                {state.kind === "none" ? <p className="max-w-md text-sm text-body">{t("comingSoonText")}</p> : null}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {state.kind === "ready" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink" id={`speed-${slug}`}>
              {t("speed")}
            </span>
            <div role="group" aria-labelledby={`speed-${slug}`} className="flex flex-wrap gap-1">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s}
                  onClick={() => changeSpeed(s)}
                  className={cn(
                    "tap-target inline-flex items-center justify-center rounded-lg px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    speed === s ? "bg-accent text-accent-foreground" : "bg-panel text-ink hover:bg-surface"
                  )}
                >
                  <span dir="ltr">{s}x</span>
                </button>
              ))}
            </div>
            {provider === "bunny" ? <span className="text-xs text-body">{t("speedNoteBunny")}</span> : null}
            {resumed ? (
              <span className="text-xs text-body" role="status">
                {t("resumed", { time: fmtTime(resumeSecond) })}
              </span>
            ) : null}
          </div>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {completed ? (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-buy" role="status">
              <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />
              {t("completed")}
            </span>
          ) : (
            <Button type="button" variant="secondary" size="sm" loading={marking} loadingText={t("marking")} onClick={markComplete}>
              {t("markComplete")}
            </Button>
          )}
          <HelpTip label={t("completedHelpLabel")}>{t("completedHelp")}</HelpTip>
        </div>
      </div>
    </div>
  );
}
