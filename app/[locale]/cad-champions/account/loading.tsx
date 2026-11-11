import { SkeletonCard } from "@/components/cad-champions/ui";

export default function CcAccountLoading() {
  return (
    <div className="container max-w-4xl space-y-6 py-8 sm:py-12" aria-busy="true">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
