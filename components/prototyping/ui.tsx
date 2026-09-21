"use client";

// Small shared pieces for the prototyping workspace. Everything here is built
// from the existing design tokens — .neu / .neu-inset surfaces, the cobalt
// accent, the Tag pill — so the workspace reads as part of the same site.

import { Check, CircleAlert, Loader2, History, Sparkles } from "lucide-react";
import { useLocale } from "next-intl";

import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/** English gets the Swiss mono/uppercase treatment; Arabic stays clean. */
export function useMono() {
  const isRtl = useLocale() === "ar";
  return (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
}

export function Kicker({ children }: { children: React.ReactNode }) {
  const mono = useMono();
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
      <span className="h-2 w-2 rounded-full bg-cobalt" />
      <span className={mono("text-[10px] text-mutedtext")}>{children}</span>
    </span>
  );
}

const STATUS_ICON = {
  generating: Loader2,
  ready: Check,
  failed: CircleAlert,
  superseded: History,
  suggestion: Sparkles,
} as const;

export function StatusTag({
  status,
  label,
}: {
  status: keyof typeof STATUS_ICON;
  label: string;
}) {
  const Icon = STATUS_ICON[status];
  const variant =
    status === "ready" ? "buy" : status === "failed" ? "inventory" : "neutral";
  return (
    <Tag variant={variant}>
      <Icon className={cn("h-3 w-3", status === "generating" && "animate-spin")} />
      {label}
    </Tag>
  );
}

/** A card, matching the .neu sections used across the projects pages. */
export function Card({
  kicker,
  title,
  intro,
  actions,
  children,
  className,
}: {
  kicker?: React.ReactNode;
  title?: React.ReactNode;
  intro?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const mono = useMono();
  return (
    <section className={cn("neu space-y-4 p-6 sm:p-8", className)}>
      {(kicker || title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            {kicker && <p className={mono("text-[10px] text-cobalt")}>{kicker}</p>}
            {title && <h2 className="text-base font-bold text-heading">{title}</h2>}
            {intro && <p className="max-w-[62ch] text-sm text-mutedtext">{intro}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** The soft raised button used all over the projects workspace. */
export function SoftButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg bg-panel px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt disabled:opacity-60",
        className
      )}
    />
  );
}

export function PrimaryButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover disabled:opacity-60",
        className
      )}
    />
  );
}

export function GhostButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-mutedtext transition-colors hover:text-heading disabled:opacity-60",
        className
      )}
    />
  );
}

export const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm leading-relaxed text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60";

export const selectClass =
  "rounded-lg border border-white/60 bg-surface px-2.5 py-1.5 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

/** Warning strip. Blocking conflicts read as errors; advice reads as a note. */
export function Warn({
  blocking,
  children,
  action,
}: {
  blocking: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed",
        blocking ? "bg-destructive/10 text-destructive" : "bg-inventory-bg text-inventory"
      )}
    >
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
