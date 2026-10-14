"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

import { Spinner } from "./spinner";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  loading?: boolean;
  loadingText?: string;
  /** Why the button is disabled. Shown as a tooltip on hover/focus. */
  disabledReason?: string;
  asChild?: boolean;
}

const base =
  "inline-flex min-h-[44px] select-none items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 " +
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-60 disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent text-accent-foreground shadow-neu-sm hover:bg-cobalt-hover",
  secondary: "bg-surface text-ink border border-white/60 shadow-neu-sm hover:shadow-neu",
  ghost: "bg-transparent text-ink hover:bg-panel",
  danger: "bg-destructive text-destructive-foreground shadow-neu-sm hover:brightness-95",
};

const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  md: "px-6 py-2.5 text-sm",
  sm: "px-4 py-2 text-sm",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    loadingText,
    disabledReason,
    asChild = false,
    className,
    disabled,
    children,
    onClick,
    ...rest
  },
  ref
) {
  const tipId = React.useId();
  const [tipOpen, setTipOpen] = React.useState(false);
  const isDisabled = Boolean(disabled) || loading;
  const showReason = Boolean(disabled) && Boolean(disabledReason);
  const Comp = asChild ? Slot : "button";

  const classes = cn(base, variants[variant], sizes[size], className);

  const content = loading ? (
    <>
      <Spinner label={loadingText ?? ""} size="sm" className={cn("text-current", !loadingText && "[&>span:last-child]:sr-only")} />
    </>
  ) : (
    children
  );

  const button = (
    <Comp
      ref={ref}
      className={classes}
      aria-busy={loading || undefined}
      aria-disabled={isDisabled || undefined}
      aria-describedby={showReason ? tipId : undefined}
      // Keep the element focusable while disabled by reason so the tooltip is reachable via the wrapper.
      disabled={asChild ? undefined : isDisabled && !showReason ? true : undefined}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {content}
    </Comp>
  );

  if (!showReason) return button;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTipOpen(true)}
      onMouseLeave={() => setTipOpen(false)}
      onFocus={() => setTipOpen(true)}
      onBlur={() => setTipOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setTipOpen(false);
      }}
    >
      {button}
      <span
        id={tipId}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute start-1/2 top-full z-50 mt-2 w-max max-w-[16rem] -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-start text-xs font-medium leading-snug text-white shadow-lg rtl:translate-x-1/2",
          tipOpen ? "block" : "hidden"
        )}
      >
        {disabledReason}
      </span>
    </span>
  );
});
