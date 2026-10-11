// W2b (2026-10-11): "How we calculated" — the Studio estimate a client saw,
// line by line in plain words, from the snapshot stored with the lead
// (inquiries.quote_calc). Server component; used by the admin lead page and
// its e2e fixture.

import { getTranslations } from "next-intl/server";
import { ExternalLink } from "lucide-react";

import type { QuoteCalc } from "@/lib/studio/request-summary";

function fmt(n: number, locale: string, digits = 2): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);
}

export async function QuoteCalcCard({ calc, locale }: { calc: QuoteCalc; locale: string }) {
  const t = await getTranslations({ locale, namespace: "LeadQuote" });
  const ar = locale === "ar";
  const q = (n: number) => fmt(n, locale);
  const unpriced = calc.components.filter((c) => c.price_qar === null).length;
  const date = calc.computed_at
    ? new Intl.DateTimeFormat(ar ? "ar-QA-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Qatar" }).format(new Date(calc.computed_at))
    : null;

  const row = "flex items-baseline justify-between gap-3 py-1.5";
  const num = "shrink-0 font-semibold tabular-nums text-heading";

  return (
    <section className="neu space-y-5 p-5 sm:p-6" aria-labelledby="quote-calc-title" data-testid="quote-calc-card">
      <div className="space-y-1">
        <h2 id="quote-calc-title" className="title-section">
          {t("calcTitle")}
        </h2>
        <p className="text-sm text-mutedtext">{t("calcIntro")}</p>
        {date && <p className="text-xs text-faint">{t("computedOn", { date })}</p>}
      </div>

      {/* 1. Printing */}
      <div className="space-y-2">
        <h3 className="title-card">{t("printingTitle")}</h3>
        {calc.printed.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm" data-testid="quote-calc-printed">
              <thead>
                <tr className="text-start text-xs text-mutedtext">
                  <th className="py-1.5 text-start font-medium">{t("colPart")}</th>
                  <th className="py-1.5 text-start font-medium">{t("colMaterial")}</th>
                  <th className="py-1.5 text-end font-medium">{t("colGrams")}</th>
                  <th className="py-1.5 text-end font-medium">{t("colCost")}</th>
                </tr>
              </thead>
              <tbody>
                {calc.printed.map((r) => (
                  <tr key={`${r.template}:${r.material}`} className="border-t border-borderstrong/50">
                    <td className="py-1.5 text-heading">{r.count > 1 ? t("printedRow", { name: ar ? r.name_ar : r.name, count: String(r.count) }) : ar ? r.name_ar : r.name}</td>
                    <td className="py-1.5 text-body" dir="ltr">{r.material}</td>
                    <td className="py-1.5 text-end tabular-nums text-body">{t("gramsTimesRate", { grams: fmt(r.grams, locale, 0), rate: q(calc.per_gram_qar) })}</td>
                    <td className="py-1.5 text-end font-semibold tabular-nums text-heading">{t("qar", { n: q(r.cost_qar) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-mutedtext">{t("noPrinted")}</p>
        )}
        <div className="rounded-xl bg-panel px-3 py-1 text-sm shadow-neu-inset">
          <div className={row}>
            <span className="text-body">{t("lineBase")}</span>
            <span className={num}>{t("qar", { n: q(calc.base_qar) })}</span>
          </div>
          <div className={row}>
            <span className="text-body">{t("lineGrams", { grams: fmt(calc.printed_grams, locale, 0), rate: q(calc.per_gram_qar) })}</span>
            <span className={num}>{t("qar", { n: q(calc.grams_qar) })}</span>
          </div>
          <div className={`${row} border-t border-borderstrong/50`}>
            <span className="font-semibold text-heading">{t("linePrint")}</span>
            <span className={num} data-testid="quote-calc-print">{t("qar", { n: q(calc.print_qar) })}</span>
          </div>
        </div>
      </div>

      {/* 2. Components */}
      <div className="space-y-2">
        <h3 className="title-card">{t("componentsTitle")}</h3>
        {calc.components.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm" data-testid="quote-calc-components">
              <thead>
                <tr className="text-xs text-mutedtext">
                  <th className="py-1.5 text-start font-medium">{t("colPart")}</th>
                  <th className="py-1.5 text-start font-medium">{t("colSku")}</th>
                  <th className="py-1.5 text-end font-medium">{t("colPrice")}</th>
                </tr>
              </thead>
              <tbody>
                {calc.components.map((c) => (
                  <tr key={c.id} className="border-t border-borderstrong/50">
                    <td className="py-1.5 text-heading">{ar ? c.name_ar : c.name}</td>
                    <td className="py-1.5 text-body" dir={c.sku ? "ltr" : undefined}>
                      {c.sku ?? t("weSource")}
                    </td>
                    <td className="py-1.5 text-end tabular-nums text-heading">{c.price_qar === null ? "—" : t("qar", { n: q(c.price_qar) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-mutedtext">{t("noComponents")}</p>
        )}
        {unpriced > 0 && <p className="text-xs text-mutedtext">{t("unpricedCount", { count: unpriced })}</p>}
      </div>

      {/* 3. Total and range */}
      <div className="rounded-xl bg-panel px-3 py-1 text-sm shadow-neu-inset">
        <div className={row}>
          <span className="text-body">{t("linePrint")}</span>
          <span className={num}>{t("qar", { n: q(calc.print_qar) })}</span>
        </div>
        <div className={row}>
          <span className="text-body">{t("lineParts")}</span>
          <span className={num}>{t("qar", { n: q(calc.parts_qar) })}</span>
        </div>
        <div className={`${row} border-t border-borderstrong/50`}>
          <span className="font-semibold text-heading">{t("lineSubtotal")}</span>
          <span className={num} data-testid="quote-calc-subtotal">{t("qar", { n: q(calc.subtotal_qar) })}</span>
        </div>
        <div className={row}>
          <span className="text-body">{t("lineLow")}</span>
          <span className={num}>{calc.low === null ? "—" : t("qar", { n: q(calc.low) })}</span>
        </div>
        <div className={row}>
          <span className="text-body">{t("lineHigh", { spread: q(calc.spread) })}</span>
          <span className={num}>{calc.high === null ? "—" : t("qar", { n: q(calc.high) })}</span>
        </div>
        <div className={`${row} border-t border-borderstrong/50`}>
          <span className="font-semibold text-heading">{t("rangeLabel")}</span>
          <span className="shrink-0 text-base font-extrabold tabular-nums text-heading" data-testid="quote-calc-range">
            {calc.low !== null && calc.high !== null ? t("range", { low: q(calc.low), high: q(calc.high) }) : t("noRange")}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-mutedtext">
          {t("ruleUsed", {
            base: q(calc.base_qar),
            rate: q(calc.per_gram_qar),
            spread: q(calc.spread),
            source: t(`source_${calc.rule_source}`),
            version: calc.rule_version || "—",
          })}
        </p>
        {calc.project_link && (
          <a
            href={calc.project_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-panel px-4 text-xs font-semibold text-heading shadow-neu-sm hover:text-cobalt"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {t("openDesign")}
          </a>
        )}
      </div>
    </section>
  );
}
