import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ContentPanels } from "@/components/cad-champions/admin/tests/content-panels";
import { ExerciseForm } from "@/components/cad-champions/admin/tests/exercise-form";
import { PublishPanel } from "@/components/cad-champions/admin/tests/publish-panel";
import { Alert, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { isValidSlug } from "@/lib/cad-champions/admin/test-builder";
import { loadExerciseEditor } from "@/lib/cad-champions/admin/test-builder-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Exercise editor (Prompt 11 Step B): all exercise fields, brief files, the
// answer STEP -> reference data, "Grade a sample", rubric (drawings),
// marking aspects (exercise_id) and publish with a blocking list.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.exercises" });
  return ccPageMetadata({ locale, path: `/admin/exercises/${slug}`, title: t("editTitle") });
}

export default async function CcAdminExerciseEditorPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, `/admin/exercises/${slug}`));
  if (!isValidSlug(slug)) notFound();
  const t = await getTranslations({ locale, namespace: "CC.admin.exercises" });
  const tt = await getTranslations({ locale, namespace: "CC.admin.tests" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadExerciseEditor(slug);

  const back = (
    <p className="text-sm">
      <Link href={ccPath(locale, "/admin/exercises")} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-2 hover:underline">
        {t("backToList")}
      </Link>
    </p>
  );

  if (!loaded.ok) {
    if (loaded.reason === "not_found") notFound();
    return (
      <div className="page-stack">
        <PageHeader title={t("editTitle")} purpose={t("editPurpose")} />
        {loaded.reason === "not_set_up" ? (
          <Alert tone="info" title={tc("notSetUp.title")}>
            {tc("notSetUp.body")}
          </Alert>
        ) : (
          <Alert tone="error" title={tc(`errors.${loaded.reason === "unavailable" ? "unavailable" : "error"}`)} />
        )}
        {back}
      </div>
    );
  }
  const ex = loaded.exercise!;
  const title = (locale === "ar" ? ex.title_ar : ex.title_en) || ex.title_en;

  return (
    <div className="page-stack">
      <PageHeader title={title} purpose={t("editPurpose")} help={<HelpTip label={t("helpLabel")}>{t("editHelp")}</HelpTip>} />
      <p className="-mt-2 text-xs text-mutedtext">
        {tt("editor.slug")} <Ltr className="font-mono">{ex.slug}</Ltr>
      </p>

      {loaded.checks ? (
        <section className="neu flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="ex-publish">
          <h2 id="ex-publish" className="title-card">
            {tt("editor.publishTitle")}
          </h2>
          <PublishPanel noun="exercise" id={ex.id} published={ex.is_published} checks={loaded.checks} />
        </section>
      ) : null}

      <section className="neu flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="ex-fields">
        <h2 id="ex-fields" className="title-card">
          {t("fieldsTitle")}
        </h2>
        <ExerciseForm key={ex.updated_at} exercise={ex} levels={loaded.levels} skills={loaded.skills} modules={loaded.modules} />
      </section>

      <section className="neu flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="ex-marking">
        <h2 id="ex-marking" className="title-card">
          {t("markingTitle")}
        </h2>
        <p className="text-sm text-body">{t("markingPurpose")}</p>
        <ContentPanels
          kind="exercise"
          row={{
            id: ex.id,
            grading_mode: ex.grading_mode,
            grader_mode: ex.grader_mode,
            reference_data: ex.reference_data,
            rubric: ex.rubric,
            max_points: Number(ex.max_points),
            skill_area_id: ex.skill_area_id == null ? null : Number(ex.skill_area_id),
            competition_module: ex.competition_module,
          }}
          aspects={loaded.aspects}
          skills={loaded.skills}
          modules={loaded.modules}
          graderReady={loaded.graderReady}
        />
      </section>

      {back}
    </div>
  );
}
