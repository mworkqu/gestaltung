import Link from "next/link";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { inputCls, labelCls } from "@/components/cad-champions/admin/fields";
import { Button } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { InsightRange } from "@/lib/cad-champions/admin/funnel";
import { formatDate } from "@/lib/cad-champions/format";
import { ccPath } from "@/lib/cad-champions/routes";

// Date range for Insights (GET form: ?from=&to=, Qatar days) plus the Pilot
// report button. Server component; the form reloads the page.

export function RangeForm({ locale, range }: { locale: Locale; range: InsightRange }) {
  const t = useTranslations("CC.admin.insights.range");
  const base = ccPath(locale, "/admin/insights");
  const report = `${ccPath(locale, "/admin/insights/report")}?${new URLSearchParams({ from: range.from, to: range.to, lang: locale }).toString()}`;
  return (
    <section className="neu space-y-4 p-5" aria-label={t("label")}>
      <form method="get" action={base} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className={`${labelCls} sm:w-48`}>
          {t("from")}
          <input type="date" name="from" defaultValue={range.from} max={range.to} className={inputCls} />
        </label>
        <label className={`${labelCls} sm:w-48`}>
          {t("to")}
          <input type="date" name="to" defaultValue={range.to} min={range.from} className={inputCls} />
        </label>
        <Button type="submit">{t("apply")}</Button>
        {range.isDefault ? null : (
          <Link href={base} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent underline-offset-2 hover:underline">
            {t("reset")}
          </Link>
        )}
      </form>
      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-body">{t("showing", { from: formatDate(`${range.from}T12:00:00+03:00`, locale), to: formatDate(`${range.to}T12:00:00+03:00`, locale) })}</p>
        <div className="flex flex-col gap-1 sm:items-end">
          <a
            href={report}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/60 bg-surface px-5 text-sm font-semibold text-ink shadow-neu-sm hover:shadow-neu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <FileText aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("pilotReport")}
          </a>
          <p className="max-w-sm text-xs text-mutedtext sm:text-end">{t("pilotHelp")}</p>
        </div>
      </div>
    </section>
  );
}
