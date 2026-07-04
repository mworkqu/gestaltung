import { getTranslations, setRequestLocale } from "next-intl/server";
import { Package, Plus, Pencil, ClipboardList, FileSpreadsheet } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/parts/format";
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
  searchParams: Promise<{ category?: string; stock?: string; published?: string }>;
}) {
  const { locale } = await params;
  const { category, stock, published } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  // super_admin RLS returns every row (published or draft).
  const { data, error } = await supabase
    .from("parts")
    .select("*")
    .order("created_at", { ascending: false });

  const all = (data ?? []) as Part[];
  const parts = all.filter(
    (p) =>
      (!category || p.category === category) &&
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
          <p className="mt-1 text-sm text-mutedtext">
            {t("count", { count: parts.length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/dashboard/parts/orders">
              <ClipboardList className="h-4 w-4" />
              {t("ordersLink")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/dashboard/parts/import">
              <FileSpreadsheet className="h-4 w-4" />
              {t("import_nav")}
            </Link>
          </Button>
          <Button asChild className="rounded-full">
            <Link href="/dashboard/parts/new">
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
            <Link href="/dashboard/parts/new">
              <Plus className="h-4 w-4" />
              {t("addPart")}
            </Link>
          </Button>
        </div>
      )}

      {!error && all.length > 0 && (
        <div className="neu mt-8 overflow-x-auto p-2">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-borderstrong/60">
                <Th mono={mono}>{t("colSku")}</Th>
                <Th mono={mono}>{t("colName")}</Th>
                <Th mono={mono}>{t("colCategory")}</Th>
                <Th mono={mono} numeric>
                  {t("colPrice")}
                </Th>
                <Th mono={mono}>{t("colStock")}</Th>
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
                  <td className="px-4 py-3 font-medium text-heading">{p.name}</td>
                  <td className="px-4 py-3 text-body">{p.category}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-body">
                    {formatPrice(p.unit_price, locale)}
                  </td>
                  <td className="px-4 py-3">
                    <StockBadge status={p.stock_status} />
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
                        <Link href={`/dashboard/parts/${p.id}/edit`}>
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
