import { SkeletonCard, SkeletonText } from "@/components/cad-champions/ui";

// Shown while the test list loads.
export default function TestListLoading() {
  return (
    <div className="container py-8 sm:py-12" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-1/2 rounded-md bg-panel motion-safe:animate-pulse" />
        <SkeletonText lines={2} />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
