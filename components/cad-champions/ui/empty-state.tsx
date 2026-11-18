import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("neu-inset flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-accent shadow-neu-sm">
        <Icon aria-hidden="true" strokeWidth={1.75} className="h-6 w-6" />
      </span>
      <h3 className="title-card">{title}</h3>
      <p className="max-w-sm text-sm text-body">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
