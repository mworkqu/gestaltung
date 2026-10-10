import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { StockListsView } from "@/components/admin/stock-lists-view";
import { loadStockData } from "@/lib/admin/stock-data";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// "What to buy" (P5-12): the Buy tile's target. Three plain lists, one order
// list per supplier. super_admin only (store layout). The detailed ranked
// table with weights stays at /dashboard/store/restock ("Details").

export const dynamic = "force-dynamic";

export default async function StockPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AdminStock");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const db = await createClient();
  const data = await loadStockData(db);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-mutedtext">{t("intro")}</p>
        </div>
        <Link href="/dashboard/store/restock" className="text-sm font-semibold text-cobalt hover:underline">
          {t("details")}
        </Link>
      </div>

      {data === null ? (
        <p className="neu p-6 text-sm text-mutedtext">{t("needsData")}</p>
      ) : (
        <>
          {!data.ownStockReady && <p className="neu p-4 text-xs text-amber-800">{t("run0069")}</p>}
          <StockListsView locale={locale} buy={data.lists.buy} watch={data.lists.watch} dont={data.lists.dont} />
        </>
      )}
    </div>
  );
}
