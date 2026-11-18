import { SkeletonCard, SkeletonText } from "@/components/cad-champions/ui";

// Loading state for the exercise pages (list, new, editor).
export default function Loading() {
  return (
    <div className="page-stack" aria-busy="true">
      <SkeletonText lines={2} />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
