import { SkeletonCard, SkeletonText } from "@/components/cad-champions/ui";

// Shown while the test workspace loads (timer, tasks, files).
export default function TestAttemptLoading() {
  return (
    <div className="container space-y-4 py-6 sm:py-8" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-1/2 rounded-md bg-panel motion-safe:animate-pulse" />
        <SkeletonText lines={1} />
      </div>
      <div className="neu flex items-center gap-4 px-5 py-4" aria-hidden="true">
        <div className="h-8 w-24 rounded-md bg-panel motion-safe:animate-pulse" />
        <div className="ms-auto h-11 w-32 rounded-full bg-panel motion-safe:animate-pulse" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-panel motion-safe:animate-pulse" />
          ))}
        </div>
        <SkeletonCard />
      </div>
    </div>
  );
}
