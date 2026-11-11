import { SkeletonCard } from "@/components/cad-champions/ui";

// Shown while your results (the list or one report) load.
export default function CcResultsLoading() {
  return (
    <div className="container space-y-6 py-8 sm:py-12" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-1/2 rounded-md bg-panel motion-safe:animate-pulse" />
        <div className="h-4 w-full rounded-md bg-panel motion-safe:animate-pulse" />
      </div>
      <div className="max-w-3xl space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
