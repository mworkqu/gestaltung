import { SkeletonCard, SkeletonTableRows, SkeletonText } from "@/components/cad-champions/ui";

// Shown while a test intro page loads.
export default function TestIntroLoading() {
  return (
    <div className="container py-8 sm:py-12" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-2/3 rounded-md bg-panel motion-safe:animate-pulse" />
        <SkeletonText lines={2} />
      </div>
      <div className="mt-8 max-w-4xl space-y-6">
        <div className="neu space-y-4 p-6 sm:p-8" aria-hidden="true">
          <div className="h-5 w-1/3 rounded-md bg-panel motion-safe:animate-pulse" />
          <SkeletonTableRows rows={4} cols={4} />
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
