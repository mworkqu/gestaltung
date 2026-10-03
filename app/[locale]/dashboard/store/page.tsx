import { getTranslations, setRequestLocale } from "next-intl/server";
import { Package, Plus, Pencil, ClipboardList, FileSpreadsheet, Truck, Zap } from "lucide-react";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/parts/format";
import { categoryLabel } from "@/lib/store/category-label";
import { StockBadge } from "@/components/parts/stock-badge";
import { PublishedToggle } from "@/components/parts/published-toggle";
import { DeletePartButton } from "@/components/parts/delete-part-button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PartsCatalogManager({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    category?: string;
    stock?: string;
    published?: string;
    merged?: string;
    review?: string;
  }>;
}) {
  const { locale } = await params;
  const { category, stock, published, merged, review } = await searchParams;
  const showMerged = merged === "1";
  const reviewOnly = review === "1";
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const ts = await getTranslations("Sourcing");
  const tq = await getTranslations("QuickEntry");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  // super_admin RLS returns every row (published or draft).
  const { rows: all, error } = await fetchAllRows<Part>((from, to) =>
    supabase.from("parts").select("*").order("created_at", { ascending: false }).order("id").range(from, to)
  );
  // Duplicates merged by 0030 (merged_into set) are hidden unless ?merged=1.
  // Before 0030 the column does not exist, so nothing counts as merged.
  const skuById = new Map(all.map((p) => [p.id, p.sku]));
  const mergedCount = all.filter((p) => p.merged_into).length;
  // C5 (0048): published products whose supplier category had no store
  // category rule, so they got "Tools and accessories" — listed for review.
  // Before 0048 the column is absent and nothing counts.
  const reviewCount = all.filter((p) => p.store_category_review && p.is_published && !p.merged_into).length;
  const parts = all.filter(
    (p) =>
      (showMerged || !p.merged_into) &&
      (!reviewOnly || (p.store_category_review && p.is_published)) &&
      (!category || p.category === category || p.store_category === category) &&
      (!stock || p.stock_status === stock) &&
      (!published ||
        (published === "published" ? p.is_published : !p.is_published))
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-mutedtext">
            <span>{t("count", { count: parts.length })}</span>
            {(mergedCount > 0 || showMerged) && (
              <Link
                href={{
                  pathname: "/dashboard/store",
                  query: {
                    ...(category ? { category } : {}),
                    ...(stock ? { stock } : {}),
                    ...(published ? { published } : {}),
                    ...(showMerged ? {} : { merged: "1" }),
                  },
                }}
                className="text-xs font-semibold text-azure hover:underline"
              >
                {showMerged ? t("filter_hide_merged") : t("filter_show_merged")}
              </Link>
            )}
            {(reviewCount > 0 || reviewOnly) && (
              <Link
                href={{ pathname: "/dashboard/store", query: reviewOnly ? {} : { review: "1" } }}
                className="text-xs font-semibold text-amber-700 hover:underline"
              >
                {reviewOnly ? t("filter_review_all") : t("filter_review_needed", { count: reviewCount })}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/dashboard/store/orders">
              <ClipboardList className="h-4 w-4" />
              {t("ordersLink")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/dashboard/store/suppliers">
              <Truck className="h-4 w-4" />
              {ts("suppliersTitle")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/dashboard/store/import">
              <FileSpreadsheet className="h-4 w-4" />
              {t("import_nav")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/dashboard/store/quick">
              <Zap className="h-4 w-4" />
              {tq("title")}
            </Link>
          </Button>
          <Button asChild className="rounded-full">
            <Link href="/dashboard/store/new">
              <Plus className="h-4 w-4" />
              {t("addPart")}
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-8 text-sm font-medium text-destructive">
          {t("error_unknown")}
        </p>
      )}

      {!error && all.length === 0 && (
        <div className="neu mt-8 flex flex-col items-center gap-4 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
            <Package className="h-7 w-7 text-cobalt" strokeWidth={1.5} />
          </span>
          <div>
            <p className="text-base font-semibold text-heading">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-mutedtext">{t("emptyBody")}</p>
          </div>
          <Button asChild className="rounded-full">
            <Link href="/dashboard/store/new">
              <Plus className="h-4 w-4" />
              {t("addPart")}
            </Link>
          </Button>
        </div>
      )}

      {!error && all.length > 0 && (
        <div className="neu mt-8 overflow-x-auto p-2">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-borderstrong/60">
                <Th mono={mono}>{t("colSku")}</Th>
                <Th mono={mono}>{t("colName")}</Th>
                <Th mono={mono}>{t("colCategory")}</Th>
                <Th mono={mono} numeric>
                  {t("colPrice")}
                </Th>
                <Th mono={mono}>{t("colStock")}</Th>
                <Th mono={mono}>{ts("leadTime")}</Th>
                <Th mono={mono} numeric>
                  {ts("incomePct")}
                </Th>
                <Th mono={mono}>{t("colPublished")}</Th>
                <Th mono={mono}>
                  <span className="sr-only">{t("colActions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-borderstrong/40 last:border-0 hover:bg-panel/50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-mutedtext">{p.sku}</td>
                  <td className="px-4 py-3 font-medium text-heading">
                    {p.name}
                    {p.merged_into && (
                      <span className="ms-2 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {t("merged_into_badge", {
                          sku: skuById.get(p.merged_into) ?? p.merged_into,
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-body">
                    {p.store_category ? (
                      <>
                        <span className={cn(p.store_category_review && "font-semibold text-amber-700")}>
                          {categoryLabel(p.store_category, locale)}
                        </span>
                        <span className="block text-[11px] text-faint">
                          {t("storeCategorySource", { category: p.category })}
                        </span>
                      </>
                    ) : (
                      p.category
                    )}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-body">
                    {formatPrice(p.unit_price, locale)}
                  </td>
                  <td className="px-4 py-3">
                    <StockBadge status={p.stock_status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-body">
                    {p.lead_time_class ? ts(`lt_${p.lead_time_class}`) : ts("onRequest")}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-end tabular-nums",
                      p.below_floor ? "font-bold text-red-700" : "text-body"
                    )}
                    title={p.below_floor ? ts("belowFloorShort") : undefined}
                  >
                    {p.income_pct === null || p.income_pct === undefined ? "—" : `${p.income_pct}%`}
                    {p.below_floor && " ⚠"}
                  </td>
                  <td className="px-4 py-3">
                    <PublishedToggle id={p.id} published={p.is_published} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        aria-label={t("edit")}
                        className="h-8 w-8 text-mutedtext hover:text-cobalt"
                      >
                        <Link href={`/dashboard/store/${p.id}/edit`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <DeletePartButton id={p.id} name={p.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  mono,
  numeric,
}: {
  children: React.ReactNode;
  mono: (extra?: string) => string;
  numeric?: boolean;
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-[10px] font-semibold text-mutedtext",
        numeric ? "text-end" : "text-start",
        mono()
      )}
    >
      {children}
    </th>
  );
}
