import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { FreePreviewToggle, PublishToggle } from "@/components/cad-champions/admin/lessons/toggles";
import { Alert, Button, EmptyState, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { recordedVideos } from "@/lib/cad-champions/admin/lessons";
import { loadCourseTree } from "@/lib/cad-champions/admin/lessons-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// Admin training content (Prompt 11): the course tree
// course -> module -> level -> lesson with the published state of each part,
// quick publish / free-preview switches and links to the edit pages.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.lessons" });
  return ccPageMetadata({ locale, path: "/admin/lessons", title: t("title") });
}

export default async function CcAdminLessonsPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/lessons"));
  const t = await getTranslations({ locale, namespace: "CC.admin.lessons" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadCourseTree();
  const n = (v: number) => formatNumber(v, locale as Locale);

  return (
    <div className="page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />

      {!loaded.ok ? (
        loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc("errors.error")} />
        )
      ) : loaded.data.length === 0 ? (
        <EmptyState icon={GraduationCap} title={t("tree.emptyTitle")} description={t("tree.emptyBody")} />
      ) : (
        loaded.data.map((course) => (
          <section key={course.id} className="flex flex-col gap-4" aria-labelledby={`course-${course.id}`}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 id={`course-${course.id}`} className="title-section">
                {pick(locale as Locale, course.title_en, course.title_ar)}
              </h2>
              <StatusChip tone={course.is_published ? "success" : "neutral"}>{course.is_published ? tc("published") : tc("draft")}</StatusChip>
              <Ltr className="font-mono text-xs text-mutedtext">{course.slug}</Ltr>
            </div>
            {course.modules.length === 0 ? <p className="text-sm text-mutedtext">{t("tree.noModules")}</p> : null}
            {course.modules.map((m) => {
              const all = m.levels.flatMap((l) => l.lessons);
              const mTitle = pick(locale as Locale, m.title_en, m.title_ar);
              return (
                <details key={m.id} className="neu group p-0" open={all.length > 0 && m.levels.length <= 2}>
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-3 p-4 sm:p-5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-extrabold text-heading">{mTitle}</span>
                      <span className="mt-0.5 block text-xs text-mutedtext">
                        <Ltr className="font-mono">{m.slug}</Ltr>
                        {m.competition_module ? ` · ${m.competition_module}` : ""}
                        {m.is_orientation ? ` · ${t("tree.orientation")}` : ""}
                        {" · "}
                        {t("tree.lessonsCount", { published: n(all.filter((l) => l.is_published).length), total: n(all.length) })}
                      </span>
                    </span>
                  </summary>
                  <div className="flex flex-col gap-4 border-t border-border p-4 sm:p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <PublishToggle entity="module" id={m.id} published={m.is_published} name={mTitle} />
                      <Button asChild variant="secondary" size="sm">
                        <Link href={ccPath(locale, `/admin/lessons/modules/${m.id}`)}>{t("tree.editModule")}</Link>
                      </Button>
                    </div>
                    {m.levels.length === 0 ? <p className="text-sm text-mutedtext">{t("tree.noLevels")}</p> : null}
                    {m.levels.map((lv) => {
                      const lTitle = pick(locale as Locale, lv.title_en, lv.title_ar);
                      return (
                        <div key={lv.id} className="tile flex flex-col gap-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="title-card min-w-0 flex-1">
                              {t("tree.level", { number: n(lv.level_number) })} · {lTitle}
                            </h3>
                            <PublishToggle entity="level" id={lv.id} published={lv.is_published} name={lTitle} />
                            <Button asChild variant="secondary" size="sm">
                              <Link href={ccPath(locale, `/admin/lessons/levels/${lv.id}`)}>{t("tree.editLevel")}</Link>
                            </Button>
                          </div>
                          {lv.lessons.length === 0 ? (
                            <p className="text-sm text-mutedtext">{t("tree.noLessons")}</p>
                          ) : (
                            <ul className="flex flex-col divide-y divide-border">
                              {lv.lessons.map((l) => {
                                const lessonTitle = pick(locale as Locale, l.title_en, l.title_ar);
                                return (
                                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
                                    <div className="min-w-0 flex-1">
                                      <Link href={ccPath(locale, `/admin/lessons/lesson/${l.id}`)} className="text-sm font-semibold text-heading underline-offset-2 hover:underline">
                                        {lessonTitle}
                                      </Link>
                                      <p className="text-xs text-mutedtext">
                                        <Ltr className="font-mono">{l.slug}</Ltr>
                                        {" · "}
                                        {t("list.videos", { count: n(recordedVideos(l)), total: n(8) })}
                                      </p>
                                    </div>
                                    <FreePreviewToggle id={l.id} value={l.is_free_preview} name={lessonTitle} />
                                    <PublishToggle entity="lesson" id={l.id} published={l.is_published} name={lessonTitle} />
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
