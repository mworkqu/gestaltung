import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ExerciseForm } from "@/components/cad-champions/admin/tests/exercise-form";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { loadExerciseEditor } from "@/lib/cad-champions/admin/test-builder-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// New exercise (Prompt 11 Step B). After "Create" the exercise page opens for
// files, the answer STEP (reference data), aspects, rubric and publishing.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.exercises" });
  return ccPageMetadata({ locale, path: "/admin/exercises/new", title: t("newTitle") });
}

export default async function CcAdminNewExercisePage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/exercises/new"));
  const t = await getTranslations({ locale, namespace: "CC.admin.exercises" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadExerciseEditor(null);

  return (
    <div className="page-stack">
      <PageHeader title={t("newTitle")} purpose={t("newPurpose")} help={<HelpTip label={t("helpLabel")}>{t("newHelp")}</HelpTip>} />
      {!loaded.ok ? (
        loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc(`errors.${loaded.reason === "unavailable" ? "unavailable" : "error"}`)} />
        )
      ) : loaded.levels.length === 0 ? (
        <Alert tone="warning" title={t("noLevelsTitle")}>
          {t("noLevelsBody")}
        </Alert>
      ) : (
        <section className="neu p-5 sm:p-6">
          <ExerciseForm exercise={null} levels={loaded.levels} skills={loaded.skills} modules={loaded.modules} />
        </section>
      )}
      <p className="text-sm">
        <Link href={ccPath(locale, "/admin/exercises")} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-2 hover:underline">
          {t("backToList")}
        </Link>
      </p>
    </div>
  );
}
