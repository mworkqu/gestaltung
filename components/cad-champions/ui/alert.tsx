import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type AlertTone = "info" | "success" | "warning" | "error";

const toneStyles: Record<AlertTone, { box: string; icon: string }> = {
  info: { box: "bg-[#e3edfb] border-[#c3d6f3]", icon: "text-[#0a3f8f]" },
  success: { box: "bg-buy-bg border-buy/20", icon: "text-buy" },
  warning: { box: "bg-inventory-bg border-inventory/20", icon: "text-inventory" },
  error: { box: "bg-[#fdecec] border-[#f3c4c2]", icon: "text-[#a1231f]" },
};

const icons: Record<AlertTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: OctagonAlert,
};

/** Inline message. role=alert for errors, role=status otherwise. Flat (no shadow), safe inside cards. */
export function Alert({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: AlertTone;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = icons[tone];
  const s = toneStyles[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start", s.box, className)}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon aria-hidden="true" strokeWidth={1.75} className={cn("mt-0.5 h-5 w-5 shrink-0", s.icon)} />
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{title}</p>
          {children ? <div className="mt-1 text-sm text-body">{children}</div> : null}
        </div>
      </div>
      {action ? <div className="shrink-0 sm:ms-4">{action}</div> : null}
    </div>
  );
}
