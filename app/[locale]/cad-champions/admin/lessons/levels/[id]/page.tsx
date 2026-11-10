import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LessonList } from "@/components/cad-champions/admin/lessons/lesson-list";
import { LevelForm } from "@/components/cad-champions/admin/lessons/level-form";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { loadLevel } from "@/lib/cad-champions/admin/lessons-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatNumber } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// Edit one level (Prompt 11) and manage its lessons: reorder, add, delete.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.lessons" });
  return ccPageMetadata({ locale, path: `/admin/lessons/levels/${id}`, title: t("level.title") });
}

export default async function CcAdminLevelPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, `/admin/lessons/levels/${id}`));
  const t = await getTranslations({ locale, namespace: "CC.admin.lessons" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadLevel(id);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  const back = ccPath(locale, "/admin/lessons");

  return (
    <div className="page-stack">
      <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("backToTree")}
      </Link>
      <PageHeader
        title={loaded.ok ? `${pick(locale as Locale, loaded.data.module.title_en, loaded.data.module.title_ar)} · ${t("tree.level", { number: formatNumber(loaded.data.level.level_number, locale as Locale) })}` : t("level.title")}
        purpose={t("level.purpose")}
        help={<HelpTip label={t("helpLabel")}>{t("level.help")}</HelpTip>}
      />
      {!loaded.ok ? (
        loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc("errors.error")} />
        )
      ) : (
        <>
          <LevelForm level={loaded.data.level} backHref={back} />
          <section className="flex flex-col gap-4" aria-labelledby="level-lessons">
            <h2 id="level-lessons" className="title-section">
              {t("list.title")}
            </h2>
            {loaded.data.exerciseCount > 0 ? <p className="text-sm text-mutedtext">{t("list.exercisesNote", { count: formatNumber(loaded.data.exerciseCount, locale as Locale) })}</p> : null}
            <LessonList levelId={loaded.data.level.id} lessons={loaded.data.lessons} />
          </section>
        </>
      )}
    </div>
  );
}
