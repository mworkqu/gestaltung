// W2b (2026-10-11): "Quote accuracy" on the admin Leads page — how the owner's
// real quotes compare with the Studio estimate, a plain suggestion for the
// rate per gram (advice only) and the rule editor. Server component.

import { getTranslations } from "next-intl/server";

import { QuoteRuleForm, type SaveRuleAction } from "@/components/admin/quote-rule-form";
import type { QuoteAccuracy } from "@/lib/studio/quote-accuracy";
import type { QuoteRule } from "@/lib/studio/request-summary";

function fmt(n: number, locale: string, digits = 2): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", { maximumFractionDigits: digits }).format(n);
}

export async function QuoteAccuracySection({
  locale,
  accuracy,
  rule,
  ruleSource,
  migrated,
  action,
}: {
  locale: string;
  accuracy: QuoteAccuracy;
  rule: QuoteRule;
  ruleSource: "settings" | "default";
  /** false = 0073 not run: no quotes can exist yet, the rule editor still works. */
  migrated: boolean;
  action: SaveRuleAction;
}) {
  const t = await getTranslations({ locale, namespace: "LeadQuote" });
  const s = accuracy.suggestion;
  const pct = (n: number) => fmt(Math.abs(n), locale, 1);
  const suggestion =
    s.kind === "too_few"
      ? t("sugTooFew", { needed: s.needed })
      : s.kind === "on_target"
        ? t("sugOnTarget", { pct: pct(s.pct) })
        : s.kind === "no_grams"
          ? t("sugNoGrams", { pct: pct(s.pct), dir: s.pct > 0 ? "above" : "below" })
          : t(s.kind === "raise" ? "sugRaise" : "sugLower", { pct: pct(s.pct), rate: fmt(s.perGramQar, locale) });
  const suggestedRate = s.kind === "raise" || s.kind === "lower" ? s.perGramQar : null;

  return (
    <section className="neu mt-6 space-y-5 p-5 sm:p-6" aria-labelledby="quote-accuracy-title" data-testid="quote-accuracy">
      <div className="space-y-1">
        <h2 id="quote-accuracy-title" className="title-section">
          {t("accTitle")}
        </h2>
        <p className="text-sm text-mutedtext">{t("accIntro")}</p>
      </div>

      {!migrated ? (
        <p className="tile text-sm font-semibold text-heading" data-testid="quote-accuracy-migration">
          {t("runMigration")}
        </p>
      ) : accuracy.count === 0 ? (
        <p className="text-sm text-mutedtext">{t("accNone")}</p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="tile">
              <dt className="text-xs text-mutedtext">{t("accCount")}</dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums text-heading">{fmt(accuracy.count, locale, 0)}</dd>
            </div>
            <div className="tile">
              <dt className="text-xs text-mutedtext">{t("accMid")}</dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums text-heading">× {accuracy.avgFinalOverMid === null ? "—" : fmt(accuracy.avgFinalOverMid, locale)}</dd>
            </div>
            <div className="tile">
              <dt className="text-xs text-mutedtext">{t("accLow")}</dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums text-heading">× {accuracy.avgFinalOverLow === null ? "—" : fmt(accuracy.avgFinalOverLow, locale)}</dd>
            </div>
          </dl>
          <p className="text-sm text-body">
            {t("accRange", { inside: String(accuracy.inside), below: String(accuracy.below), above: String(accuracy.above) })}
          </p>
        </>
      )}

      {migrated && (
        <div className="space-y-1">
          <p className="text-base font-semibold text-heading" data-testid="quote-accuracy-suggestion">
            {suggestion}
          </p>
          <p className="text-xs text-mutedtext">{t("sugNote")}</p>
        </div>
      )}

      <div className="border-t border-borderstrong/60 pt-4">
        {ruleSource === "default" && <p className="mb-2 text-xs text-mutedtext">{t("ruleDefaultNote")}</p>}
        <QuoteRuleForm locale={locale} rule={rule} suggestedRate={suggestedRate} action={action} />
      </div>
    </section>
  );
}
