"use client";

import { useLocale, useTranslations } from "next-intl";

import { Alert } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { AspectSplit } from "@/lib/cad-champions/admin/aspects";
import { JUDGEMENT_WARN_PERCENT } from "@/lib/cad-champions/admin/aspects";
import { formatNumber } from "@/lib/cad-champions/format";
import { cn } from "@/lib/utils";

// Measurement vs judgement points of a test (or one task): a two-colour bar,
// the points and percentages, and a clear warning above 20 % judgement
// (COMPETITION_ALIGNMENT section D). `compact` = one line for the list.

export function SplitMeter({ split, compact = false, className }: { split: AspectSplit; compact?: boolean; className?: string }) {
  const t = useTranslations("CC.admin.tests");
  const locale = useLocale() as Locale;
  const n = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 2 });

  if (split.total <= 0) return <p className={cn("text-xs text-mutedtext", className)}>{t("split.none")}</p>;

  const bar = (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel" role="img" aria-label={t("split.aria", { measurement: n(split.measurementPercent), judgement: n(split.judgementPercent) })}>
      <span className="h-full bg-accent" style={{ width: `${split.measurementPercent}%` }} />
      <span className={cn("h-full", split.judgementTooHigh ? "bg-destructive" : "bg-inventory")} style={{ width: `${split.judgementPercent}%` }} />
    </div>
  );

  if (compact) {
    return (
      <div className={cn("flex min-w-32 flex-col gap-1", className)}>
        {bar}
        <span className={cn("text-xs", split.judgementTooHigh ? "font-semibold text-destructive" : "text-mutedtext")}>
          {t("split.short", { measurement: n(split.measurementPercent), judgement: n(split.judgementPercent) })}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {bar}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="flex items-center gap-2 font-semibold text-ink">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
            {t("split.measurement")}
          </dt>
          <dd className="text-mutedtext">{t("split.points", { points: n(split.measurement), percent: n(split.measurementPercent) })}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-2 font-semibold text-ink">
            <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-full", split.judgementTooHigh ? "bg-destructive" : "bg-inventory")} />
            {t("split.judgement")}
          </dt>
          <dd className="text-mutedtext">{t("split.points", { points: n(split.judgement), percent: n(split.judgementPercent) })}</dd>
        </div>
      </dl>
      {split.judgementTooHigh ? (
        <Alert tone="warning" title={t("split.warnTitle", { limit: n(JUDGEMENT_WARN_PERCENT) })}>
          {t("split.warnBody")}
        </Alert>
      ) : null}
    </div>
  );
}
