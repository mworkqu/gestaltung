import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LessonForm } from "@/components/cad-champions/admin/lessons/lesson-form";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { loadLesson } from "@/lib/cad-champions/admin/lessons-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// Edit one lesson (Prompt 11). Notes, videos and downloads are read with the
// service role (students cannot select those columns since 0083).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.lessons" });
  return ccPageMetadata({ locale, path: `/admin/lessons/lesson/${id}`, title: t("lesson.pageTitle") });
}

export default async function CcAdminLessonPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, `/admin/lessons/lesson/${id}`));
  const t = await getTranslations({ locale, namespace: "CC.admin.lessons" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadLesson(id);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  const back = loaded.ok ? ccPath(locale, `/admin/lessons/levels/${loaded.data.level.id}`) : ccPath(locale, "/admin/lessons");

  return (
    <div className="page-stack">
      <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("lesson.backToLevel")}
      </Link>
      <PageHeader
        title={loaded.ok ? pick(locale as Locale, loaded.data.lesson.title_en, loaded.data.lesson.title_ar) : t("lesson.pageTitle")}
        purpose={t("lesson.purpose")}
        help={<HelpTip label={t("helpLabel")}>{t("lesson.help")}</HelpTip>}
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
        <LessonForm lesson={loaded.data.lesson} backHref={back} />
      )}
    </div>
  );
}
