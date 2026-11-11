import { SkeletonCard, SkeletonText } from "@/components/cad-champions/ui";

// Shown while the Get Ready page loads its progress.
export default function GetReadyLoading() {
  return (
    <div className="container py-8 sm:py-12" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-2/3 rounded-md bg-panel motion-safe:animate-pulse" />
        <SkeletonText lines={2} />
      </div>
      <div className="mt-8 max-w-4xl space-y-3">
        <SkeletonCard />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="neu space-y-3 p-6" aria-hidden="true">
            <div className="h-4 w-1/4 rounded-md bg-panel motion-safe:animate-pulse" />
            <div className="h-5 w-1/2 rounded-md bg-panel motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
