import { getTranslations } from "next-intl/server";

import { Skeleton } from "@/components/ui/skeleton";

// Shared body of the route loading screens (app/[locale]/{dashboard,projects,orders}/loading.tsx):
// a few neu skeleton blocks and an announced "Loading…" for screen readers.
export async function RouteLoading() {
  const t = await getTranslations("RouteState");
  return (
    <div className="container py-10" role="status" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      <div className="max-w-2xl space-y-3">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="neu space-y-3 p-6">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="neu space-y-3 p-6">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    </div>
  );
}
