import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { pageQuery, type SearchParamsLike } from "@/lib/admin/pagination";
import { formatNumber } from "@/lib/cad-champions/format";

// Prev / next links for a paged admin list (?page=N kept with the other
// filters). Server component; pages compute `page` and `pages` themselves
// (lib/admin/pagination.ts paginate(), or a DB range + count).

function href(basePath: string, params: SearchParamsLike, page: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(pageQuery(params, page))) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

const linkCls =
  "inline-flex min-h-11 items-center gap-1 rounded-full px-4 text-sm font-semibold text-accent hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export async function AdminPagination({
  locale,
  basePath,
  params,
  page,
  pages,
  total,
}: {
  locale: Locale;
  /** Public CC path of the list, e.g. ccPath(locale, "/admin/students"). */
  basePath: string;
  params: SearchParamsLike;
  page: number;
  pages: number;
  total?: number;
}) {
  if (pages <= 1 && total == null) return null;
  const t = await getTranslations({ locale, namespace: "CC.admin.common" });
  return (
    <nav aria-label={t("pagination")} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-mutedtext">
        {t("pageOf", { page: formatNumber(page, locale), pages: formatNumber(pages, locale) })}
        {total != null ? ` · ${t("totalRows", { count: formatNumber(total, locale) })}` : ""}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(basePath, params, page - 1)} className={linkCls} rel="prev">
            <ChevronLeft aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
            {t("previous")}
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(basePath, params, page + 1)} className={linkCls} rel="next">
            {t("next")}
            <ChevronRight aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
