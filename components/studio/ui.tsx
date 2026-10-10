"use client";

// Small building blocks shared by the Design Studio steps: the step card
// (accent kicker, title, line, content, ONE sticky main button), the cobalt
// main button, quiet secondary links and a bottom sheet. Light neu tokens.

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { STEP_ACCENT, type StepId } from "@/lib/studio/palette";
import { cn } from "@/lib/utils";

/** The one main (cobalt) button of a step: 48 px, full width on phones. */
export function MainButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-cobalt px-7 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(14,89,197,0.7)] transition-[background-color,transform] hover:bg-cobalt-hover active:scale-[0.98] disabled:opacity-60 sm:w-auto",
        className,
      )}
    />
  );
}

/** A secondary action: a text link that is still a 44 px target. */
export const linkCls =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-cobalt hover:text-cobalt-hover disabled:opacity-60";

export function StepFrame({
  step,
  n,
  title,
  headline,
  intro,
  children,
  footer,
  secondary,
}: {
  step: StepId;
  n: number;
  title: string;
  headline: string;
  intro: string;
  children: React.ReactNode;
  /** The ONE main button (sticky at the bottom on phones). */
  footer?: React.ReactNode;
  /** Secondary text links next to it. */
  secondary?: React.ReactNode;
}) {
  const t = useTranslations("Studio");
  const accent = STEP_ACCENT[step];
  return (
    <section
      aria-labelledby={`studio-${step}-title`}
      data-step={step}
      className="neu relative space-y-5 p-5 sm:p-8"
      style={{ "--step-accent": accent.base, "--step-ink": accent.ink, "--step-soft": accent.soft } as React.CSSProperties}
    >
      <header className="space-y-2">
        <p className="kicker flex items-center gap-2 font-semibold" style={{ color: accent.ink }}>
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: accent.base }} />
          {t("kicker", { n: String(n), title })}
        </p>
        <h1 id={`studio-${step}-title`} className="text-2xl font-extrabold leading-tight tracking-tight text-heading sm:text-3xl">
          {headline}
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-mutedtext sm:text-base">{intro}</p>
      </header>
      {children}
      {(footer || secondary) && (
        // `contents` on phones: the secondary links scroll with the page and ONLY the main
        // button (with a soft canvas fade behind it) sticks, so the bar never hides more than
        // ~100 px. The section's own bottom padding is the spacer: the last content always
        // scrolls fully above the bar (+ the safe-area inset).
        <div className="contents sm:flex sm:items-center sm:justify-between sm:gap-2 sm:pt-2">
          <div className="flex flex-wrap items-center justify-center gap-x-3 sm:justify-start max-sm:mt-5 max-sm:empty:hidden">{secondary}</div>
          <div className="sticky bottom-0 z-10 -mx-5 -mb-5 rounded-b-[28px] bg-gradient-to-t from-[#eef2f7] from-60% via-[#eef2f7]/90 to-[#eef2f7]/0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10 sm:static sm:m-0 sm:bg-none sm:p-0">
            {footer}
          </div>
        </div>
      )}
    </section>
  );
}

/** A plain one-line problem under a button. */
export function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm font-medium text-destructive">
      {children}
    </p>
  );
}

/** Bottom sheet on phones, centred dialog from sm. Escape / backdrop close it. */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("Studio");
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="neu max-h-[85dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-b-none bg-surface p-5 motion-safe:animate-rise sm:rounded-b-[28px] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={id} className="text-base font-bold text-heading">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mutedtext hover:text-heading"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Grey bars in the shape of what is loading (never a bare spinner). */
export function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded-full bg-[#dfe5ee] motion-safe:animate-pulse", className)} />;
}
