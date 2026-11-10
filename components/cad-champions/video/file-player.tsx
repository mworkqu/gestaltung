"use client";

import * as React from "react";
import { Film, Play } from "lucide-react";

import type { Locale } from "@/i18n/routing";
import { WATCHED_THRESHOLD, fileVideoSources, watchedFraction } from "@/lib/cad-champions/videos/registry";
import { cn } from "@/lib/utils";

/**
 * A self-hosted CAD Champions clip (registry provider "file", public bucket
 * `videos`). Lighthouse-friendly: until the viewer presses play only the
 * poster is fetched, as a plain lazy <img>; the click mounts a <video> with
 * native controls (sound allowed, it is the viewer's gesture), the cut in the
 * page language and both caption tracks (the page language on by default).
 * `onWatched` fires once at 90% played (Get Ready step 1 completes itself).
 */
export function FilePlayer({
  id,
  locale,
  title,
  playLabel,
  onWatched,
  className,
}: {
  id: string;
  locale: Locale;
  title: string;
  /** Visible text and accessible name of the play button. */
  playLabel: string;
  onWatched?: () => void;
  className?: string;
}) {
  const src = fileVideoSources(id, locale, process.env.NEXT_PUBLIC_SUPABASE_URL);
  const [started, setStarted] = React.useState(false);
  const [posterMissing, setPosterMissing] = React.useState(false);
  const firedRef = React.useRef(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (started) void videoRef.current?.play().catch(() => undefined);
  }, [started]);

  function onTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    if (!onWatched || firedRef.current) return;
    const v = e.currentTarget;
    if (watchedFraction(v.currentTime, v.duration) >= WATCHED_THRESHOLD) {
      firedRef.current = true;
      onWatched();
    }
  }

  return (
    <div className={cn("neu-inset relative aspect-video w-full overflow-hidden rounded-2xl", className)}>
      {!src ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Film aria-hidden="true" strokeWidth={1.5} className="h-10 w-10 text-mutedtext" />
          <p className="max-w-md text-base font-bold text-ink">{title}</p>
        </div>
      ) : started ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full bg-ink object-contain"
          controls
          playsInline
          preload="none"
          // Captions come from Supabase Storage (another origin, CORS *).
          crossOrigin="anonymous"
          poster={src.poster}
          aria-label={title}
          onTimeUpdate={onTimeUpdate}
          onEnded={onTimeUpdate}
        >
          <source src={src.webm} type="video/webm" />
          <source src={src.mp4} type="video/mp4" />
          <track kind="captions" srcLang={locale} src={src.captions[locale]} label={locale === "ar" ? "العربية" : "English"} default />
          {locale === "ar" ? (
            <track kind="captions" srcLang="en" src={src.captions.en} label="English" />
          ) : (
            <track kind="captions" srcLang="ar" src={src.captions.ar} label="العربية" />
          )}
        </video>
      ) : (
        <button
          type="button"
          onClick={() => setStarted(true)}
          aria-label={playLabel}
          className="group absolute inset-0 flex h-full w-full items-center justify-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-accent"
        >
          {posterMissing ? (
            <span className="absolute inset-0 flex items-center justify-center p-6 text-center text-base font-bold text-ink">{title}</span>
          ) : (
            // Plain <img> by design: no image-optimisation quota, nothing loads before it is near.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src.poster}
              alt=""
              width={1280}
              height={720}
              loading="lazy"
              decoding="async"
              onError={() => setPosterMissing(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <span className="relative flex items-center gap-2 rounded-full bg-ink/85 px-5 py-3 text-sm font-semibold text-white shadow-neu-sm transition-colors group-hover:bg-cobalt sm:text-base">
            <Play aria-hidden="true" strokeWidth={2} className="h-5 w-5 rtl:-scale-x-100" />
            <span>{playLabel}</span>
          </span>
        </button>
      )}
    </div>
  );
}
