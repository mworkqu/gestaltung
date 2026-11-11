import { SkeletonCard } from "@/components/cad-champions/ui";

// Fallback while any admin page without its own loading state fetches data
// (the side nav stays on screen because the layout is not re-rendered).
export default function CcAdminLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <div className="h-9 w-1/2 rounded-md bg-panel motion-safe:animate-pulse" />
        <div className="h-4 w-full rounded-md bg-panel motion-safe:animate-pulse" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
