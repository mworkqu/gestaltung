import { Layers } from "lucide-react";

import { Ltr } from "@/lib/cad-champions/ltr";
import { cn } from "@/lib/utils";

/** Competition module chip ("M3"), with the module name for screen readers and on hover. */
export function ModuleChip({ code, name, className }: { code: string; name: string | null; className?: string }) {
  return (
    <span
      title={name ?? undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[#c3d6f3] bg-[#e3edfb] px-3 py-1 text-xs font-semibold leading-none text-[#0a3f8f]",
        className
      )}
    >
      <Layers aria-hidden="true" strokeWidth={1.75} className="h-3.5 w-3.5 shrink-0" />
      <Ltr>{code}</Ltr>
      {name ? <span className="sr-only">{name}</span> : null}
    </span>
  );
}
