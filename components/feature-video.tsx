"use client";

// Self-hosted feature video (CC-2). One short clip from the public Supabase
// bucket `videos` (lib/videos.ts has the layout and the pure rules).
//
//   - preload="none": nothing but the poster is fetched until the clip plays.
//   - Plays on its own (muted, inline) once at least half of it is on screen
//     and pauses when it leaves; never under prefers-reduced-motion, never in a
//     poster-only slot (the workspace empty states play on click).
//   - Every piece of text arrives as a prop, so public pages need no message
//     scope (the server wrapper feature-video-section.tsx reads the copy).
//   - Missing files never break a page: if no video source loads we show the
//     poster as a plain <img>; if the poster is also missing, a placeholder.

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Pause, Play, RotateCcw } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { canAutoplay, videoSources } from "@/lib/videos";
import { cn } from "@/lib/utils";

export type FeatureVideoProps = {
  slug: string;
  /** Public bucket base, see videoBase(). */
  base: string;
  title: string;
  caption?: string;
  playLabel: string;
  pauseLabel: string;
  replayLabel: string;
  ratio?: "16/9" | "4/3";
  size?: "large" | "small";
  posterOnly?: boolean;
  locale: "en" | "ar";
  /** Makes the caption a link. */
  href?: string;
};

export function FeatureVideo({
  slug,
  base,
  title,
  caption,
  playLabel,
  pauseLabel,
  replayLabel,
  ratio = "16/9",
  size = "large",
  posterOnly = false,
  locale,
  href,
}: FeatureVideoProps) {
  const src = videoSources(base, slug);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [posterMissing, setPosterMissing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Nothing (not even the poster) is requested until the frame is within
  // 200 px of the viewport, so the page's first paint weighs the same.
  const [near, setNear] = useState(false);

  // The observer callback outlives renders: read the live values from a ref.
  const live = useRef({ reducedMotion, missing, posterOnly, userPaused: false });
  live.current.reducedMotion = reducedMotion;
  live.current.missing = missing;
  live.current.posterOnly = posterOnly;

  // prefers-reduced-motion: read at mount and follow changes.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReducedMotion(query.matches);
      if (query.matches) videoRef.current?.pause();
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // Near the viewport? One observer with a margin, disconnected once true.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Is the poster there? (Cached, so the <video poster> reuses this request.)
  useEffect(() => {
    if (!near) return;
    const probe = new window.Image();
    probe.onerror = () => setPosterMissing(true);
    probe.src = src.poster;
    return () => {
      probe.onerror = null;
    };
  }, [near, src.poster]);

  // Autoplay when at least half is visible, pause when it leaves.
  useEffect(() => {
    const frame = frameRef.current;
    if (!near || !frame || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const video = videoRef.current;
        if (!video) return;
        const inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (
          !live.current.userPaused &&
          canAutoplay({
            reducedMotion: live.current.reducedMotion,
            inView,
            missing: live.current.missing,
            posterOnly: live.current.posterOnly,
          })
        ) {
          void video.play().catch(() => {});
        } else if (!entry.isIntersecting) {
          video.pause();
        }
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [near]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended) video.currentTime = 0;
    if (video.paused || video.ended) {
      live.current.userPaused = false;
      void video.play().catch(() => {});
    } else {
      live.current.userPaused = true;
      video.pause();
    }
  }, []);

  const small = size === "small";
  const label = ended ? replayLabel : playing ? pauseLabel : playLabel;
  const Icon = ended ? RotateCcw : playing ? Pause : Play;
  // Placeholder: before mounting, when nothing at all could load, or while a
  // poster-less clip has not started (play fires before a source can fail,
  // so `started` alone is not proof that anything is showing).
  const showPlaceholder = !near || (posterMissing && (missing || !started));

  return (
    <figure className="min-w-0 space-y-3">
      <div
        ref={frameRef}
        className="neu-inset relative w-full overflow-hidden rounded-2xl"
        style={{ aspectRatio: ratio === "4/3" ? "4 / 3" : "16 / 9" }}
      >
        {!near ? null : missing ? (
          !posterMissing && (
            // Plain <img> by design: no image-optimisation quota (lib/store/image-url.ts).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src.poster}
              alt={title}
              width={1280}
              height={720}
              loading="lazy"
              onError={() => setPosterMissing(true)}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            preload="none"
            playsInline
            muted
            // Captions come from another origin (Supabase Storage, CORS *):
            // without this the browser refuses to load the <track>.
            crossOrigin="anonymous"
            poster={src.poster}
            aria-label={title}
            onPlay={() => {
              setPlaying(true);
              setStarted(true);
              setEnded(false);
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setEnded(true);
            }}
          >
            <source src={src.webm} type="video/webm" />
            {/* The last source: when it fails, no format could be loaded. */}
            <source src={src.mp4} type="video/mp4" onError={() => setMissing(true)} />
            <track
              kind="captions"
              srcLang={locale}
              src={src.captions[locale]}
              label={locale === "ar" ? "العربية" : "English"}
              default
            />
          </video>
        )}

        {showPlaceholder && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel p-4 text-center">
            <Film className="h-8 w-8 text-faint" strokeWidth={1.5} aria-hidden />
            <span className="text-xs font-semibold text-mutedtext">{title}</span>
          </div>
        )}

        {near && !missing && (
          <button
            type="button"
            onClick={toggle}
            aria-label={label}
            className={cn(
              "absolute flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white shadow-neu-sm transition-colors hover:bg-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60 focus-visible:ring-offset-2",
              small ? "bottom-2 start-2" : "bottom-3 start-3",
            )}
          >
            <Icon className={cn("h-5 w-5", Icon === Play && "ms-0.5")} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      <figcaption className={cn("space-y-0.5", !small && "px-1")}>
        <p className={cn("font-semibold text-heading", small ? "text-sm" : "text-sm sm:text-base")}>{title}</p>
        {caption &&
          (href ? (
            <p className="text-xs text-mutedtext">
              <Link
                href={href}
                className="inline-flex items-center font-medium text-cobalt hover:text-cobalt-hover hover:underline max-md:min-h-11"
              >
                {caption}
              </Link>
            </p>
          ) : (
            <p className="text-xs text-mutedtext">{caption}</p>
          ))}
      </figcaption>
    </figure>
  );
}
