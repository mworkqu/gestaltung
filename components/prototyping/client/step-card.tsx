"use client";

// One step of the client view (P5-04): a numbered card with a plain title and
// one main button. No counters, no legends; the badge is a number, or a tick
// once the step is done. Built from the neu tokens like the rest of the site.

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { ClientStepStatus } from "@/lib/prototyping/client-steps";

export function StepCard({
  id,
  n,
  status,
  title,
  intro,
  children,
}: {
  id: string;
  n: number;
  status: ClientStepStatus;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("ClientView");
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("neu space-y-5 p-5 sm:p-8", status === "upcoming" && "opacity-90")}
    >
      <header className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums",
            status === "done"
              ? "bg-emerald-600 text-white"
              : status === "current"
                ? "bg-cobalt text-white"
                : "bg-panel text-mutedtext shadow-neu-sm"
          )}
        >
          {status === "done" ? <Check className="h-4 w-4" aria-hidden /> : n}
          {status === "done" && <span className="sr-only">{t("stepDone")}</span>}
        </span>
        <div className="min-w-0 space-y-1 pt-0.5">
          <h2 id={`${id}-title`} className="text-lg font-extrabold leading-tight tracking-tight text-heading">
            {title}
          </h2>
          {intro && <p className="text-sm leading-relaxed text-mutedtext">{intro}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** The step's one main button: full width on a phone, 48 px tall. */
export function BigButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-cobalt px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover disabled:opacity-60 sm:w-auto",
        className
      )}
    />
  );
}

/** The quieter button next to it. */
export function SoftBigButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-panel px-5 py-2 text-sm font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt disabled:opacity-60",
        className
      )}
    />
  );
}

/** A small text link that is still a 44 px target. */
export const textLinkClass =
  "inline-flex min-h-11 items-center gap-1 px-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover";
