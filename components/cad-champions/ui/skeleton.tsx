import { cn } from "@/lib/utils";

const bar = "rounded-md bg-panel motion-safe:animate-pulse";

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cn(bar, "h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("neu space-y-4 p-6", className)}>
      <div className={cn(bar, "h-5 w-1/3")} />
      <SkeletonText lines={3} />
      <div className={cn(bar, "h-10 w-28 rounded-full")} />
    </div>
  );
}

/** Div-based table skeleton (plain divs, so no horizontal-scroll wrapper is needed). */
export function SkeletonTableRows({
  rows = 4,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn("space-y-3", className)}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className={cn(bar, "h-4 flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}
