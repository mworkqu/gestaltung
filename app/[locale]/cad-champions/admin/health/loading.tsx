import { SkeletonCard } from "@/components/cad-champions/ui";

// Loading state while the admin numbers are read (skeletons, not a spinner).
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
