import Link from "next/link";
import { LineChart, TrendingDown, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button, EmptyState, HelpTip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { ccPath } from "@/lib/cad-champions/routes";
import { deltaSinceLast } from "@/lib/cad-champions/scoring/core";
import { loadUserAttempts } from "@/lib/cad-champions/scoring/load";

const W = 320;
const H = 120;
const PAD = 16;

/**
 * Dashboard "Your progress" card (Prompt 7 Step E): overall % per scored
 * attempt as a small line chart (oldest left, drawn left-to-right in both
 * languages), the change since the last attempt, and the retake button with
 * its unlock date. Server component; pass the signed-in user's id only.
 */
export async function ProgressCard({ userId, locale }: { userId: string; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.results.progress" });
  const res = await loadUserAttempts(userId, locale);
  const items = res.ok ? res.items : [];
  const scored = items.filter((a) => a.percent != null && (a.status === "graded" || a.status === "provisional")).reverse(); // oldest first
  const latest = items[0] ?? null;
  const delta = deltaSinceLast(scored.map((a) => a.percent));
  const retakeAt = latest?.retakeAt ?? null;
  const canRetake = retakeAt == null || retakeAt <= Date.now();

  const pts = scored.map((a, i) => {
    const x = scored.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (scored.length - 1);
    const y = PAD + ((100 - Math.min(100, Math.max(0, a.percent as number))) * (H - 2 * PAD)) / 100;
    return { x, y, p: a.percent as number, id: a.id };
  });

  return (
    <section className="neu flex flex-col gap-4 p-6" aria-labelledby="cc-progress-heading">
      <div className="flex items-center gap-2">
        <h2 id="cc-progress-heading" className="text-lg font-extrabold text-heading">
          {t("title")}
        </h2>
        <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
      </div>

      {scored.length === 0 ? (
        <EmptyState icon={LineChart} title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("chartLabel")} className="h-auto w-full max-w-md" direction="ltr" style={{ direction: "ltr" }}>
            {[0, 50, 100].map((g) => {
              const y = PAD + ((100 - g) * (H - 2 * PAD)) / 100;
              return <line key={g} x1={PAD} x2={W - PAD} y1={y} y2={y} className="stroke-border" strokeWidth={1} strokeDasharray={g === 50 ? "3 4" : undefined} />;
            })}
            {pts.length > 1 ? (
              <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="stroke-cobalt" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            ) : null}
            {pts.map((p) => (
              <g key={p.id}>
                <circle cx={p.x} cy={p.y} r={4} className="fill-cobalt" />
                <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={10} className="fill-ink" fontWeight={700}>
                  {`${Math.round(p.p)}%`}
                </text>
              </g>
            ))}
          </svg>
          <ul className="sr-only">
            {scored.map((a) => (
              <li key={a.id}>
                {formatDate(a.submittedAt ?? a.startedAt, locale)}: {Math.round(a.percent as number)}%
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            {delta == null ? (
              <span className="font-normal text-body">{t("single")}</span>
            ) : delta > 0 ? (
              <>
                <TrendingUp aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-buy" />
                {t("deltaUp", { delta: formatNumber(Math.round(delta), locale) })}
              </>
            ) : delta < 0 ? (
              <>
                <TrendingDown aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-[#a1231f]" />
                {t("deltaDown", { delta: formatNumber(Math.round(Math.abs(delta)), locale) })}
              </>
            ) : (
              t("deltaSame")
            )}
          </p>
        </>
      )}

      {latest ? (
        <div className="mt-auto flex flex-wrap items-center gap-3">
          <Button asChild variant={canRetake ? "primary" : "secondary"}>
            <Link href={ccPath(locale, `/test/${latest.testSlug}`)}>{t("retake")}</Link>
          </Button>
          {!canRetake ? <span className="text-xs text-body">{t("retakeOn", { date: formatDate(retakeAt as number, locale) })}</span> : null}
          <Link href={ccPath(locale, "/results")} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline">
            {t("viewAll")}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
