import * as React from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  purpose,
  help,
  actions,
  className,
}: {
  title: string;
  purpose: string;
  help?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-heading ltr:tracking-tight rtl:tracking-normal sm:text-4xl">
            {title}
          </h1>
          {help ? <span className="shrink-0">{help}</span> : null}
        </div>
        <p className="mt-2 max-w-2xl text-base text-body">{purpose}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
