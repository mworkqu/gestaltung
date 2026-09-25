// Offer coverage summary for Admin → Suppliers (SITE_AUDIT #6). A published
// product with no active supplier offer has no lead time, so customers see
// "Available on request". This strip puts that number up front.
//
// Server component (no "use client"): rendered by the suppliers page, which
// does the (RLS-scoped, super_admin) queries and passes the result in.

import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, PackageSearch } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type CoverageOffer = { part_id: string; supplier_id: string; active: boolean };
export type CoveragePart = { id: string; name: string; name_ar: string | null };

export type Coverage = {
  /** Active offers from active suppliers (the ones that can give a lead time). */
  activeOffers: number;
  /** Published, non-merged products with at least one active offer. */
  withOffer: number;
  /** Published, non-merged products with no active offer ("Available on request"). */
  withoutOffer: number;
  /** First published product without an active offer, for a direct edit link. */
  firstWithout: CoveragePart | null;
};

// Pure: count active offers and split published products by whether they have
// one. An offer counts when it is active and its supplier is active — the same
// rule recompute_part_sourcing (migration 0028) uses to derive a lead time.
export function computeCoverage(
  offers: CoverageOffer[],
  activeSupplierIds: ReadonlySet<string>,
  publishedParts: CoveragePart[]
): Coverage {
  const covered = new Set<string>();
  let activeOffers = 0;
  for (const o of offers) {
    if (!o.active || !activeSupplierIds.has(o.supplier_id)) continue;
    activeOffers += 1;
    covered.add(o.part_id);
  }
  let withOffer = 0;
  let firstWithout: CoveragePart | null = null;
  for (const p of publishedParts) {
    if (covered.has(p.id)) withOffer += 1;
    else if (!firstWithout) firstWithout = p;
  }
  return {
    activeOffers,
    withOffer,
    withoutOffer: publishedParts.length - withOffer,
    firstWithout,
  };
}

export function OfferCoverage({
  coverage,
  locale,
}: {
  coverage: Coverage | null;
  locale: string;
}) {
  const t = useTranslations("Sourcing");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  // A failed query is an error, not "0 offers".
  if (!coverage) {
    return (
      <div role="alert" className="neu flex items-start gap-3 p-6 text-sm font-medium text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{t("cov_error")}</p>
      </div>
    );
  }

  const firstName =
    coverage.firstWithout &&
    (isRtl && coverage.firstWithout.name_ar?.trim() ? coverage.firstWithout.name_ar : coverage.firstWithout.name);

  const stats: { key: string; value: number; warn: boolean }[] = [
    { key: "cov_activeOffers", value: coverage.activeOffers, warn: coverage.activeOffers === 0 },
    { key: "cov_withOffer", value: coverage.withOffer, warn: false },
    { key: "cov_withoutOffer", value: coverage.withoutOffer, warn: coverage.withoutOffer > 0 },
  ];

  const linkClass =
    "inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-4 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt";
  const arrow = <ArrowRight className={cn("h-4 w-4", isRtl && "rotate-180")} />;

  return (
    <section aria-labelledby="offer-coverage-title" className="neu space-y-5 p-6">
      <h2 id="offer-coverage-title" className={mono("text-[10px] text-azure")}>
        {t("cov_title")}
      </h2>

      <dl className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.key}
            className={cn("rounded-xl bg-panel p-4 shadow-neu-sm", s.warn && "ring-2 ring-amber-400/70")}
          >
            <dt className="text-xs text-mutedtext">{t(s.key)}</dt>
            <dd
              className={cn("mt-1 text-3xl font-extrabold tabular-nums", s.warn ? "text-amber-700" : "text-heading")}
              dir="ltr"
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      {coverage.activeOffers === 0 ? (
        <div className="neu-inset flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
            <PackageSearch className="h-6 w-6 text-amber-700" strokeWidth={1.5} />
          </span>
          <div className="space-y-2">
            <p className="text-base font-semibold text-heading">{t("cov_emptyTitle")}</p>
            <p className="max-w-3xl text-sm text-body">{t("cov_emptyBody")}</p>
            <p className="max-w-3xl text-sm text-body">{t("cov_emptyHow")}</p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/dashboard/store" className={linkClass}>
                {t("cov_openCatalog")}
                {arrow}
              </Link>
              {coverage.firstWithout && (
                <Link href={`/dashboard/store/${coverage.firstWithout.id}/edit`} className={linkClass}>
                  {t("cov_openFirst", { name: firstName ?? "" })}
                  {arrow}
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : (
        coverage.withoutOffer > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50/70 p-4 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="flex-1">
              {t("cov_gapBody", { count: coverage.withoutOffer, n: String(coverage.withoutOffer) })}
            </p>
            <Link href="/dashboard/store?offers=none" className={linkClass}>
              {t("cov_gapLink")}
              {arrow}
            </Link>
          </div>
        )
      )}
    </section>
  );
}
