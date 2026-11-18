import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Circle, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneStyles: Record<ChipTone, string> = {
  neutral: "bg-panel text-body border-border",
  info: "bg-[#e3edfb] text-[#0a3f8f] border-[#c3d6f3]",
  success: "bg-buy-bg text-buy border-buy/20",
  warning: "bg-inventory-bg text-inventory border-inventory/20",
  danger: "bg-[#fdecec] text-[#a1231f] border-[#f3c4c2]",
};

const defaultIcons: Record<ChipTone, LucideIcon> = {
  neutral: Circle,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
};

/** Status pill. Always icon plus text, never colour alone. */
export function StatusChip({
  tone,
  icon,
  children,
  className,
}: {
  tone: ChipTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = icon ?? defaultIcons[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold leading-none",
        toneStyles[tone],
        className
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} className="h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </span>
  );
}
