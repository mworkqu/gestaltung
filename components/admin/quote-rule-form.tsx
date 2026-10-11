"use client";

// W2b (2026-10-11): the Studio estimate rule (base, rate per gram, spread) as
// data — store_settings.studio_quote_rule. super_admin server action passed in.
// "Use QAR x" copies the accuracy suggestion into the rate field; nothing is
// saved until the owner presses Save.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { SaveRuleResult } from "@/app/[locale]/dashboard/leads/actions";
import type { QuoteRule } from "@/lib/studio/request-summary";

export type SaveRuleAction = (input: { locale: string; base_qar: string; per_gram_qar: string; spread: string }) => Promise<SaveRuleResult>;

const FIELDS: { key: keyof QuoteRule; label: "ruleBase" | "ruleRate" | "ruleSpread"; step: string }[] = [
  { key: "base_qar", label: "ruleBase", step: "1" },
  { key: "per_gram_qar", label: "ruleRate", step: "0.01" },
  { key: "spread", label: "ruleSpread", step: "0.05" },
];

export function QuoteRuleForm({
  locale,
  rule,
  suggestedRate,
  action,
}: {
  locale: string;
  rule: QuoteRule;
  suggestedRate: number | null;
  action: SaveRuleAction;
}) {
  const t = useTranslations("LeadQuote");
  const [draft, setDraft] = useState<Record<keyof QuoteRule, string>>({
    base_qar: String(rule.base_qar),
    per_gram_qar: String(rule.per_gram_qar),
    spread: String(rule.spread),
  });
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SaveRuleResult | null>(null);
  const bad = result && !result.ok ? (result.bad ?? []) : [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        setResult(await action({ locale, ...draft }));
      } catch {
        setResult({ ok: false, error: "failed" });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="quote-rule-form" noValidate>
      <h3 className="title-card">{t("ruleTitle")}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-heading">{t(f.label)}</span>
            <input
              type="number"
              inputMode="decimal"
              step={f.step}
              dir="ltr"
              value={draft[f.key]}
              onChange={(e) => {
                setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                setResult(null);
              }}
              aria-invalid={bad.includes(f.key)}
              className={`neu-inset rounded-xl px-3 py-2 tabular-nums text-heading outline-none focus-visible:ring-2 focus-visible:ring-azure ${bad.includes(f.key) ? "ring-2 ring-[#b91c1c]" : ""}`}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-mutedtext">{t("ruleHint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-6 text-sm font-semibold text-white hover:bg-cobalt-hover disabled:opacity-60"
        >
          {pending ? t("saving") : t("ruleSave")}
        </button>
        {suggestedRate !== null && String(suggestedRate) !== draft.per_gram_qar && (
          <button
            type="button"
            onClick={() => {
              setDraft((d) => ({ ...d, per_gram_qar: String(suggestedRate) }));
              setResult(null);
            }}
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("useSuggestion", { rate: String(suggestedRate) })}
          </button>
        )}
        <p role="status" className="text-sm">
          {result?.ok ? <span className="font-semibold text-buy">{t("ruleSaved")}</span> : null}
          {result && !result.ok ? <span className="font-semibold text-[#b91c1c]">{result.error === "invalid" ? t("ruleErr") : t(`err_${result.error}`)}</span> : null}
        </p>
      </div>
    </form>
  );
}
