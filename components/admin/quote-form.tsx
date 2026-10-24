"use client";

// W2b (2026-10-11): "Your quote (QAR)" on a Studio request. The owner types the
// price they send the client (+ an optional note); the difference from the
// estimate midpoint updates as they type. Save = super_admin server action
// (passed in, so the e2e fixture can pass a no-write one).

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { SaveQuoteResult } from "@/app/[locale]/dashboard/leads/actions";
import { parseFinalQuote, quoteDifference } from "@/lib/studio/request-summary";
import { intlTag, asLocale } from "@/lib/locale";

export type SaveQuoteAction = (input: { id: string; locale: string; finalQar: string; note: string }) => Promise<SaveQuoteResult>;

function fmt(n: number, locale: string): string {
  return new Intl.NumberFormat(intlTag(asLocale(locale)), { maximumFractionDigits: 2 }).format(n);
}

export function QuoteForm({
  leadId,
  locale,
  midpoint,
  initialFinal,
  initialNote,
  action,
}: {
  leadId: string;
  locale: string;
  midpoint: number | null;
  initialFinal: number | null;
  initialNote: string | null;
  action: SaveQuoteAction;
}) {
  const t = useTranslations("LeadQuote");
  const [value, setValue] = useState(initialFinal === null ? "" : String(initialFinal));
  const [note, setNote] = useState(initialNote ?? "");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SaveQuoteResult | null>(null);

  const parsed = parseFinalQuote(value);
  const diff = parsed === null ? null : quoteDifference(parsed, { midpoint });
  const invalid = value.trim() !== "" && parsed === null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (parsed === null) {
      setResult({ ok: false, error: "invalid" });
      return;
    }
    start(async () => {
      try {
        setResult(await action({ id: leadId, locale, finalQar: value, note }));
      } catch {
        setResult({ ok: false, error: "failed" });
      }
    });
  }

  const err = result && !result.ok ? result.error : null;

  return (
    <form onSubmit={submit} className="neu space-y-4 p-5 sm:p-6" data-testid="quote-form" noValidate>
      <div className="space-y-1">
        <label htmlFor="final-quote" className="title-section block">
          {t("formTitle")}
        </label>
        <p className="text-sm text-mutedtext">{t("formHint")}</p>
      </div>
      <input
        id="final-quote"
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setResult(null);
        }}
        aria-invalid={invalid || err === "invalid"}
        aria-describedby="final-quote-diff"
        placeholder="450"
        className="neu-inset w-full max-w-xs rounded-xl px-4 py-3 text-lg font-bold tabular-nums text-heading outline-none focus-visible:ring-2 focus-visible:ring-azure"
      />
      <p id="final-quote-diff" className="text-sm" aria-live="polite" data-testid="quote-diff">
        {diff === null ? (
          midpoint === null ? null : <span className="text-mutedtext">{t("diffLabel", { mid: fmt(midpoint, locale) })}</span>
        ) : (
          <>
            <span className="text-mutedtext">{t("diffLabel", { mid: fmt(midpoint!, locale) })}: </span>
            <span className={diff.qar === 0 ? "font-semibold text-heading" : diff.qar > 0 ? "font-semibold text-buy" : "font-semibold text-[#b45309]"}>
              {diff.qar === 0
                ? t("diffSame")
                : t(diff.qar > 0 ? "diffAbove" : "diffBelow", { qar: fmt(Math.abs(diff.qar), locale), pct: fmt(Math.abs(diff.pct), locale) })}
            </span>
          </>
        )}
      </p>
      <div className="space-y-1.5">
        <label htmlFor="quote-note" className="text-sm font-medium text-heading">
          {t("noteLabel")}
        </label>
        <textarea
          id="quote-note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setResult(null);
          }}
          placeholder={t("notePlaceholder")}
          className="neu-inset w-full rounded-xl px-4 py-3 text-sm text-heading outline-none focus-visible:ring-2 focus-visible:ring-azure"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-6 text-sm font-semibold text-white hover:bg-cobalt-hover disabled:opacity-60"
        >
          {pending ? t("saving") : t("save")}
        </button>
        <p role="status" className="text-sm" data-testid="quote-form-status">
          {result?.ok ? <span className="font-semibold text-buy">{t("saved", { amount: fmt(result.finalQar, locale) })}</span> : null}
          {err ? <span className="font-semibold text-[#b91c1c]">{t(`err_${err}`)}</span> : null}
        </p>
      </div>
    </form>
  );
}
