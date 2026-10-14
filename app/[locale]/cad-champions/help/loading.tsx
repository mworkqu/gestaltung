import { SkeletonCard } from "@/components/cad-champions/ui";

// Shown while the Help Center loads its articles.
export default function CcHelpLoading() {
  return (
    <div className="container space-y-6 py-8 sm:py-12" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-1/2 rounded-md bg-panel motion-safe:animate-pulse" />
        <div className="h-4 w-full rounded-md bg-panel motion-safe:animate-pulse" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
