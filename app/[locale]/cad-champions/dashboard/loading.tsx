import { SkeletonCard } from "@/components/cad-champions/ui";

// Shown while the dashboard loads your journey, progress and next steps.
export default function CcDashboardLoading() {
  return (
    <div className="container page-stack" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-2/3 rounded-md bg-panel motion-safe:animate-pulse" />
        <div className="h-4 w-full rounded-md bg-panel motion-safe:animate-pulse" />
      </div>
      <SkeletonCard />
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
