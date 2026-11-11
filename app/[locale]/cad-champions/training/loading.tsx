import { SkeletonCard, SkeletonText } from "@/components/cad-champions/ui";

// Shown while a training page loads the catalog and your progress.
export default function TrainingLoading() {
  return (
    <div className="container py-8 sm:py-12" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-2/3 rounded-md bg-panel motion-safe:animate-pulse" />
        <SkeletonText lines={2} />
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
