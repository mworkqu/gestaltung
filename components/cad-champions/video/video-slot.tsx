"use client";

import * as React from "react";
import { Film } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { Locale } from "@/i18n/routing";
import {
  WATCHED_THRESHOLD,
  getPlaybackUrl,
  getVideoSlot,
  videoTitle,
  watchedFraction,
  type VideoKey,
} from "@/lib/cad-champions/videos/registry";
import { cn } from "@/lib/utils";

const YT_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * A 16:9 video slot from the registry. Placeholder slots show the title on a
 * calm panel; YouTube slots embed a privacy-enhanced, lazy iframe and call
 * `onWatched` once 90% has been played (read through the YouTube iframe
 * postMessage API; no YouTube script is loaded).
 */
export function VideoSlot({
  videoKey,
  onWatched,
  className,
}: {
  videoKey: VideoKey;
  onWatched?: () => void;
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("CC.get-ready");
  const slot = getVideoSlot(videoKey);
  const title = videoTitle(slot, locale);
  const direct = getPlaybackUrl(slot);
  // Bunny Stream slots need a signed link from the server (2 h, access-checked).
  const [signed, setSigned] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (slot.provider !== "bunny" || !slot.providerId) return;
    let alive = true;
    fetch(`/api/cad-champions/video/${encodeURIComponent(`intro:${videoKey}`)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { embedUrl?: string } | null) => {
        if (alive && b?.embedUrl) setSigned(b.embedUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slot.provider, slot.providerId, videoKey]);
  const src = direct ?? signed;
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const firedRef = React.useRef(false);
  const durationRef = React.useRef(0);

  React.useEffect(() => {
    if (!src || !onWatched) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== YT_ORIGIN || e.source !== frameRef.current?.contentWindow) return;
      let data: unknown;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const info = (data as { info?: { currentTime?: unknown; duration?: unknown } } | null)?.info;
      if (!info) return;
      if (typeof info.duration === "number" && info.duration > 0) durationRef.current = info.duration;
      const fraction = watchedFraction(info.currentTime, durationRef.current);
      if (!firedRef.current && fraction >= WATCHED_THRESHOLD) {
        firedRef.current = true;
        onWatched?.();
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [src, onWatched]);

  function startListening() {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: videoKey, channel: "widget" }), YT_ORIGIN);
  }

  return (
    <div className={cn("neu-inset relative aspect-video w-full overflow-hidden rounded-2xl", className)}>
      {src ? (
        <iframe
          ref={frameRef}
          src={src}
          title={t("video.playerLabel", { title })}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          onLoad={startListening}
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <div
          role="img"
          aria-label={t("video.placeholderLabel", { title })}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <Film aria-hidden="true" strokeWidth={1.5} className="h-10 w-10 text-mutedtext" />
          <p className="max-w-md text-base font-bold text-ink">{title}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
            {t("video.comingSoon")}
          </p>
        </div>
      )}
    </div>
  );
}
