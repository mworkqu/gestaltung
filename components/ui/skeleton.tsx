import { cn } from "@/lib/utils";

/**
 * A grey placeholder bar for content that has not arrived yet (audit #59):
 * shown instead of a fake zero or a bare spinner. It pulses only when the
 * visitor has not asked for reduced motion.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded-md bg-borderstrong/30 motion-safe:animate-pulse", className)} />;
}
