import { SkeletonCard, SkeletonTableRows, SkeletonText } from "@/components/cad-champions/ui";

// Skeleton while the Students pages load (list, detail, in-person).

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonText lines={2} className="max-w-xl" />
      <SkeletonCard />
      <div className="neu p-5">
        <SkeletonTableRows rows={8} cols={6} />
      </div>
    </div>
  );
}
