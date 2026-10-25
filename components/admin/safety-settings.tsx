"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";

import { saveCleanupSettings, saveTurnstileSwitch } from "@/app/[locale]/dashboard/usage/actions";
import { CLEANUP_MIN_DAYS, type CleanupSettings } from "@/lib/cleanup/anonymous";
import { cn } from "@/lib/utils";
import { intlTag, asLocale } from "@/lib/locale";

// Dashboard → AI usage & pricing (super_admin): the Turnstile switch (P2-08)
// and the weekly guest-account cleanup (P2-09) with its last five runs.

export type CleanupRun = { id: number; ran_at: string; dry_run: boolean; days: number; candidates: number; deleted: number };

const saveBtn =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cobalt px-4 text-sm font-semibold text-white disabled:opacity-50 md:min-h-9";

export function SafetySettings({
  locale,
  turnstile,
  cleanup,
  runs,
}: {
  locale: string;
  turnstile: { enabled: boolean; siteKeySet: boolean; secretSet: boolean };
  cleanup: CleanupSettings;
  /** null = cleanup_runs not readable yet (0055 not run). */
  runs: CleanupRun[] | null;
}) {
  const t = useTranslations("Safety");
  // The widget is a client component, so Next inlines the site key at BUILD
  // time. `turnstile.siteKeySet` is what the SERVER sees right now, so the two
  // disagree whenever the variable was added in Vercel after the last build —
  // and that is exactly what "I set the key and nothing happened" looks like.
  // Saying so here saves the next hour of hunting.
  const siteKeyInBuild = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const needsRedeploy = turnstile.siteKeySet && !siteKeyInBuild;
  const [tsOn, setTsOn] = useState(turnstile.enabled);
  const [tsMsg, setTsMsg] = useState<string | null>(null);
  const [tsPending, startTs] = useTransition();

  const [enabled, setEnabled] = useState(cleanup.enabled);
  const [dryRun, setDryRun] = useState(cleanup.dryRun);
  const [days, setDays] = useState(String(cleanup.days));
  const [clMsg, setClMsg] = useState<string | null>(null);
  const [clPending, startCl] = useTransition();

  const date = (iso: string) =>
    new Date(iso).toLocaleString(intlTag(asLocale(locale)), { dateStyle: "medium", timeStyle: "short" });
  const keyBadge = (set: boolean) => (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
        set ? "bg-emerald-100 text-emerald-800" : "bg-panel text-mutedtext shadow-neu-inset"
      )}
    >
      {set ? t("keySet") : t("keyMissing")}
    </span>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="neu space-y-4 p-5">
        <div>
          <p className="text-base font-bold text-heading">{t("turnstileTitle")}</p>
          <p className="mt-1 text-xs text-mutedtext">{t("turnstileHelp")}</p>
        </div>
        <dl className="space-y-1 text-[12px] text-body">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="font-mono text-[11px]" dir="ltr">{t("turnstileSiteKey")}</dt>
            <dd>{keyBadge(turnstile.siteKeySet)}</dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="font-mono text-[11px]" dir="ltr">{t("turnstileSecret")}</dt>
            <dd>{keyBadge(turnstile.secretSet)}</dd>
          </div>
        </dl>
        {needsRedeploy && (
          <p className="rounded-xl bg-amber-100 px-3 py-2 text-[12px] font-medium leading-relaxed text-amber-900">
            {t("turnstileNeedsRedeploy")}
          </p>
        )}
        <details className="text-[12px] text-mutedtext">
          <summary className="min-h-6 cursor-pointer font-medium text-cobalt">{t("turnstileOrderTitle")}</summary>
          <p className="mt-1.5 leading-relaxed">{t("turnstileWarning")}</p>
        </details>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={tsOn} onChange={(e) => setTsOn(e.target.checked)} />
            {t("turnstileOn")}
          </label>
          <button
            type="button"
            disabled={tsPending}
            onClick={() =>
              startTs(async () => {
                const r = await saveTurnstileSwitch(locale, tsOn);
                setTsMsg(r.error ?? t("saved"));
              })
            }
            className={saveBtn}
          >
            {tsPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("save")}
          </button>
          {tsMsg && <span className="text-sm text-mutedtext">{tsMsg}</span>}
        </div>
      </section>

      <section className="neu space-y-4 p-5">
        <div>
          <p className="text-base font-bold text-heading">{t("cleanupTitle")}</p>
          <p className="mt-1 text-xs text-mutedtext">{t("cleanupHelp")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t("cleanupEnabled")}
          </label>
          <label className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            {t("cleanupDryRun")}
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("cleanupDays")}</span>
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              dir="ltr"
              className="w-20 rounded-lg border border-white/60 bg-surface px-2 py-1 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
            />
            <span className="block text-[11px] text-mutedtext">{t("cleanupDaysHint")}</span>
          </label>
          <button
            type="button"
            disabled={clPending}
            onClick={() =>
              startCl(async () => {
                const n = Math.max(CLEANUP_MIN_DAYS, Number(days) || CLEANUP_MIN_DAYS);
                const r = await saveCleanupSettings(locale, { enabled, dryRun, days: n });
                if (!r.error) setDays(String(Math.trunc(n)));
                setClMsg(r.error ?? t("saved"));
              })
            }
            className={saveBtn}
          >
            {clPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("save")}
          </button>
          {clMsg && <span className="text-sm text-mutedtext">{clMsg}</span>}
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-semibold text-heading">{t("cleanupRuns")}</p>
          {runs === null ? (
            <p className="text-[12px] text-mutedtext">{t("needsMigration")}</p>
          ) : runs.length === 0 ? (
            <p className="text-[12px] text-mutedtext">{t("noRuns")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-faint">
                    <th className="pb-1 text-start font-medium">{t("colRan")}</th>
                    <th className="pb-1 text-start font-medium">{t("colMode")}</th>
                    <th className="pb-1 text-end font-medium">{t("colCandidates")}</th>
                    <th className="pb-1 text-end font-medium">{t("colDeleted")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borderstrong/40">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5 text-mutedtext">{date(r.ran_at)}</td>
                      <td className="py-1.5">{r.dry_run ? t("modeDry") : t("modeReal")}</td>
                      <td className="py-1.5 text-end font-mono tabular-nums">{r.candidates}</td>
                      <td className="py-1.5 text-end font-mono tabular-nums">{r.deleted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
