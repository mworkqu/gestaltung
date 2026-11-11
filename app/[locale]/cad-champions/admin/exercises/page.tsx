import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Dumbbell, Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Alert, Button, EmptyState, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { loadExerciseList, type ExerciseListRow, type LevelOption } from "@/lib/cad-champions/admin/test-builder-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Admin exercises (Prompt 11 Step B): every exercise grouped by training
// module and level, with publish state and whether its answer data exists.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.exercises" });
  return ccPageMetadata({ locale, path: "/admin/exercises", title: t("title") });
}

type Group = { key: string; title: string; levels: { level: LevelOption | null; rows: ExerciseListRow[] }[] };

export default async function CcAdminExercisesPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/exercises"));
  const t = await getTranslations({ locale, namespace: "CC.admin.exercises" });
  const tt = await getTranslations({ locale, namespace: "CC.admin.tests" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadExerciseList();
  const pick = (en: string, ar: string) => (locale === "ar" ? ar || en : en || ar);
  const n = (v: number) => formatNumber(v, locale as Locale, { maximumFractionDigits: 2 });

  const newLink = (
    <Button asChild>
      <Link href={ccPath(locale, "/admin/exercises/new")}>
        <Plus aria-hidden="true" className="h-4 w-4" />
        {t("new")}
      </Link>
    </Button>
  );

  const groups: Group[] = [];
  if (loaded.ok) {
    const byLevel = new Map<string, ExerciseListRow[]>();
    for (const r of loaded.rows) byLevel.set(r.level_id, [...(byLevel.get(r.level_id) ?? []), r]);
    const seen = new Set<string>();
    for (const lv of loaded.levels) {
      const rows = byLevel.get(lv.id);
      if (!rows) continue;
      seen.add(lv.id);
      let g = groups.find((x) => x.key === lv.moduleId);
      if (!g) {
        g = { key: lv.moduleId, title: pick(lv.moduleTitle_en, lv.moduleTitle_ar), levels: [] };
        groups.push(g);
      }
      g.levels.push({ level: lv, rows });
    }
    const orphans = loaded.rows.filter((r) => !seen.has(r.level_id));
    if (orphans.length) groups.push({ key: "none", title: t("noModule"), levels: [{ level: null, rows: orphans }] });
  }

  return (
    <div className="page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} actions={newLink} />

      {!loaded.ok ? (
        loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone={loaded.reason === "unavailable" ? "warning" : "error"} title={tc(`errors.${loaded.reason === "unavailable" ? "unavailable" : "error"}`)} />
        )
      ) : loaded.rows.length === 0 ? (
        <EmptyState icon={Dumbbell} title={t("emptyTitle")} description={t("emptyBody")} action={newLink} />
      ) : (
        groups.map((g) => (
          <section key={g.key} className="neu flex flex-col gap-4 p-5 sm:p-6" aria-label={g.title}>
            <h2 className="title-card">{g.title}</h2>
            {g.levels.map(({ level, rows }) => (
              <div key={level?.id ?? "none"} className="flex flex-col gap-2">
                {level ? <h3 className="text-sm font-semibold text-mutedtext">{t("levelOption", { n: formatNumber(level.level_number, locale as Locale), title: pick(level.title_en, level.title_ar) })}</h3> : null}
                <ul className="flex flex-col gap-2">
                  {[...rows]
                    .sort((a, b) => a.sort - b.sort)
                    .map((r) => (
                      <li key={r.id} className="tile flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <Link href={ccPath(locale, `/admin/exercises/${r.slug}`)} className="flex min-h-11 min-w-0 flex-col justify-center font-semibold text-accent underline-offset-2 hover:underline">
                          <span>{pick(r.title_en, r.title_ar)}</span>
                          <Ltr className="text-xs font-normal text-mutedtext">{r.slug}</Ltr>
                        </Link>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-mutedtext">
                          <StatusChip tone={r.is_published ? "success" : "neutral"}>{r.is_published ? tc("published") : tc("draft")}</StatusChip>
                          {r.is_free_sample ? <StatusChip tone="info">{t("freeSampleChip")}</StatusChip> : null}
                          {r.competition_module ? <StatusChip tone="info">{r.competition_module}</StatusChip> : null}
                          <span>{tt(`gradingModes.${r.grading_mode}`)}</span>
                          <span>{tt("aspects.pointsShort", { points: n(Number(r.max_points)) })}</span>
                          {r.grading_mode === "auto_step" && !r.hasReference ? <StatusChip tone="warning">{tt("tasks.noReference")}</StatusChip> : null}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
