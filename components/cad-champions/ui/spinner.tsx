"use client";

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** Spinner with a visible, live label. */
export function Spinner({
  label,
  size = "md",
  className,
}: {
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-2 text-body", size === "sm" ? "text-sm" : "text-base", className)}
    >
      <Loader2
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn("shrink-0 animate-spin motion-reduce:animate-none", size === "sm" ? "h-4 w-4" : "h-5 w-5")}
      />
      <span>{label}</span>
    </span>
  );
}
