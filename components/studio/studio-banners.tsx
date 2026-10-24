"use client";

// Presentational pieces of the Studio shell (split out of StudioShell, R8).
// Plain props, no translations of their own: the shell passes the strings.

import { useLayoutEffect, useRef } from "react";

/**
 * A faded step, opened on purpose: why it is probably not needed for this build, and a clear
 * way to carry on. The step itself is rendered below it unchanged — the visitor may overrule us.
 */
export function FadedBanner({
  title,
  reason,
  continueLabel,
  onContinue,
  last,
}: {
  title: string;
  reason: string;
  continueLabel: string;
  onContinue: () => void;
  last: boolean;
}) {
  return (
    <aside
      className="neu-inset mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
      data-testid="studio-faded-banner"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="kicker text-mutedtext">{title}</p>
        <p className="text-sm leading-relaxed text-heading">{reason}</p>
      </div>
      {!last && (
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex min-h-11 items-center rounded-xl bg-panel px-4 text-sm font-bold text-cobalt shadow-neu-sm transition-colors hover:text-cobalt-hover"
        >
          {continueLabel}
        </button>
      )}
    </aside>
  );
}

/**
 * 3d: shown on EVERY step of a class project. The age line is the rule the
 * owner set ("12+ with adult supervision"); the breadboard line appears on the
 * steps where a team is holding parts.
 */
export function ClassBanner({
  teamName,
  label,
  banner,
  more,
  breadboard,
}: {
  teamName: string;
  label: string;
  banner: string;
  more: string;
  breadboard: string | null;
}) {
  return (
    <aside className="neu-inset space-y-1 rounded-2xl p-4" aria-label={teamName}>
      <p className="kicker text-mutedtext">{label}</p>
      <p className="text-sm font-bold text-heading">{banner}</p>
      <p className="text-xs leading-relaxed text-mutedtext">{more}</p>
      {breadboard && <p className="text-xs leading-relaxed text-mutedtext">{breadboard}</p>}
    </aside>
  );
}

/**
 * Step change: the new card slides in from the side it comes from (forwards = from the
 * reading end, back = from the start; mirrored in Arabic) while fading in. Web
 * Animations only (nothing left behind on the element), skipped with reduced motion.
 */
export function StepSlide({ index, children }: { index: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(index);
  useLayoutEffect(() => {
    const el = ref.current;
    const from = prev.current;
    prev.current = index;
    if (!el || from === index || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const dx = (index > from ? 1 : -1) * (rtl ? -1 : 1) * 28;
    el.animate(
      [
        { opacity: 0, transform: `translateX(${dx}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: 340, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
  }, [index]);
  return <div ref={ref}>{children}</div>;
}
