import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { pageQuery, type Paged, type SearchParamsLike } from "@/lib/admin/pagination";
import { cn } from "@/lib/utils";

// Previous / next for a long dashboard list (D2). Works in server and client
// components (no hooks besides next-intl). Keeps every search/filter param in
// the URL; renders nothing when everything fits on one page.
export function ListPagination({
  pathname,
  params,
  paged,
  className,
}: {
  /** Locale-free path, e.g. "/dashboard/store". */
  pathname: string;
  /** The page's current search params (filters, search). */
  params: SearchParamsLike;
  paged: Pick<Paged<unknown>, "page" | "pages" | "total" | "from" | "to">;
  className?: string;
}) {
  const t = useTranslations("DashboardNav");
  if (paged.pages <= 1) return null;

  const prev = paged.page > 1 ? paged.page - 1 : null;
  const next = paged.page < paged.pages ? paged.page + 1 : null;
  const btn =
    "inline-flex min-h-11 items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors";

  return (
    <nav aria-label={t("listPages")} className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-sm text-mutedtext">
        {t("listShowing", { from: String(paged.from), to: String(paged.to), total: String(paged.total) })}
      </p>
      <div className="flex items-center gap-2">
        {prev ? (
          <Link href={{ pathname, query: pageQuery(params, prev) }} rel="prev" className={cn(btn, "bg-panel text-heading shadow-neu-sm hover:text-cobalt")}>
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
            {t("listPrev")}
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(btn, "text-faint")}>
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
            {t("listPrev")}
          </span>
        )}
        <span className="px-1 text-sm tabular-nums text-body">
          {t("listPage", { page: String(paged.page), pages: String(paged.pages) })}
        </span>
        {next ? (
          <Link href={{ pathname, query: pageQuery(params, next) }} rel="next" className={cn(btn, "bg-panel text-heading shadow-neu-sm hover:text-cobalt")}>
            {t("listNext")}
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(btn, "text-faint")}>
            {t("listNext")}
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}
