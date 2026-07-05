import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { SheetImportForm } from "@/components/parts/sheet-import-form";
import { SHEET_COLUMNS } from "@/lib/parts/sheet-import";
import { cn } from "@/lib/utils";

// "Store filling": import the catalog from a Google Sheet. super_admin only
// (the parent dashboard/parts layout enforces it). The STORE catalog (`parts`)
// is entirely separate from the production `inventory_items`.
export const dynamic = "force-dynamic";

export default async function StoreImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const defaultUrl = process.env.STORE_SHEET_CSV_URL ?? "";

  const steps = [
    t("import_how_1"),
    t("import_how_2"),
    t("import_how_3"),
    t("import_how_4"),
  ];

  return (
    <div className="space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 rounded-full">
          <Link href="/dashboard/store">
            <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
            {t("import_back")}
          </Link>
        </Button>
        <p className={mono("text-[10px] text-azure")}>{t("import_kicker")}</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-extrabold text-heading">
          <FileSpreadsheet className="h-6 w-6 text-cobalt" strokeWidth={1.5} />
          {t("import_title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mutedtext">
          {t("import_intro")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Import form */}
        <div className="neu space-y-6 p-6">
          <SheetImportForm locale={locale === "ar" ? "ar" : "en"} defaultUrl={defaultUrl} />
        </div>

        {/* How-to + columns */}
        <aside className="space-y-6">
          <div className="neu space-y-3 p-5">
            <h2 className="text-sm font-bold text-heading">{t("import_how_title")}</h2>
            <ol className="space-y-2 text-sm text-mutedtext">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel font-mono text-[11px] text-cobalt shadow-neu-sm">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="neu space-y-3 p-5">
            <h2 className="text-sm font-bold text-heading">
              {t("import_columns_title")}
            </h2>
            <p className="text-xs leading-relaxed text-mutedtext">
              {t("import_columns_note")}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {SHEET_COLUMNS.map((c) => (
                <li
                  key={c.key}
                  className={cn(
                    "rounded-md px-2 py-1 font-mono text-[11px]",
                    c.required
                      ? "bg-cobalt/10 text-cobalt"
                      : "bg-panel text-mutedtext"
                  )}
                >
                  {c.key}
                  {c.required ? " *" : ""}
                </li>
              ))}
            </ul>
            <p className="text-[11px] leading-relaxed text-faint">
              {t("import_columns_required")}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
