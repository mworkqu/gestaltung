import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PackageExpectationsEditor } from "@/components/cad-champions/admin/tests/package-expectations-editor";
import { PublishPanel } from "@/components/cad-champions/admin/tests/publish-panel";
import { SplitMeter } from "@/components/cad-champions/admin/tests/split-meter";
import { TaskList } from "@/components/cad-champions/admin/tests/task-list";
import { TestSettingsForm } from "@/components/cad-champions/admin/tests/test-settings-form";
import { Alert, Button, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { isValidSlug } from "@/lib/cad-champions/admin/test-builder";
import { loadTestEditor } from "@/lib/cad-champions/admin/test-builder-server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Test builder (Prompt 11 Step B + COMPETITION_ALIGNMENT P "Task 11"): test
// fields, tasks (add / edit / reorder / delete) with files, points, grading,
// reference data, "Grade a sample", rubric and marking aspects; the
// measurement/judgement split; package expectations for module_package
// tests; publish with a blocking list. Admin only.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.tests" });
  return ccPageMetadata({ locale, path: `/admin/tests/${slug}`, title: t("editor.metaTitle") });
}

export default async function CcAdminTestEditorPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, `/admin/tests/${slug}`));
  if (!isValidSlug(slug)) notFound();
  const t = await getTranslations({ locale, namespace: "CC.admin.tests" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const loaded = await loadTestEditor(slug);

  const back = (
    <p className="text-sm">
      <Link href={ccPath(locale, "/admin/tests")} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-2 hover:underline">
        {t("backToList")}
      </Link>
    </p>
  );

  if (!loaded.ok) {
    if (loaded.reason === "not_found") notFound();
    return (
      <div className="page-stack">
        <PageHeader title={t("editor.metaTitle")} purpose={t("editor.purpose")} />
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

  const { test, tasks, aspects, skills, modules, graderReady, checks } = loaded;
  const title = (locale === "ar" ? test.title_ar : test.title_en) || test.title_en;
  const isPackage = test.upload_mode === "module_package";
  const sortedTasks = [...tasks].sort((a, b) => a.position - b.position);

  return (
    <div className="page-stack">
      <PageHeader
        title={title}
        purpose={t("editor.purpose")}
        help={<HelpTip label={t("editor.helpLabel")}>{t("editor.help")}</HelpTip>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href={ccPath(locale, `/admin/tests/${test.slug}/preview`)}>
                <Eye aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                {t("editor.preview")}
              </Link>
            </Button>
            {isPackage ? (
              <Button asChild variant="secondary">
                <Link href={ccPath(locale, `/admin/students/in-person?test=${encodeURIComponent(test.slug)}`)}>
                  <Users aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  {t("editor.inPerson")}
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <p className="-mt-2 text-xs text-mutedtext">
        {t("editor.slug")} <Ltr className="font-mono">{test.slug}</Ltr>
      </p>

      <section className="neu flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="test-publish">
        <h2 id="test-publish" className="title-card">
          {t("editor.publishTitle")}
        </h2>
        <PublishPanel noun="test" id={test.id} published={test.is_published} checks={checks} />
      </section>

      <section className="neu flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="test-split">
        <h2 id="test-split" className="title-card flex items-center gap-1">
          {t("editor.splitTitle")}
          <HelpTip label={t("editor.splitHelpLabel")}>{t("editor.splitHelp")}</HelpTip>
        </h2>
        <SplitMeter split={checks.split} />
      </section>

      <section className="neu flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="test-settings">
        <h2 id="test-settings" className="title-card">
          {t("editor.settingsTitle")}
        </h2>
        <TestSettingsForm key={test.updated_at} test={test} />
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="test-tasks">
        <div>
          <h2 id="test-tasks" className="title-section">
            {t("editor.tasksTitle")}
          </h2>
          <p className="mt-1 text-sm text-body">{t("editor.tasksPurpose")}</p>
        </div>
        <TaskList testId={test.id} tasks={tasks} aspects={aspects} skills={skills} modules={modules} graderReady={graderReady} />
      </section>

      {isPackage ? (
        <section className="neu flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="test-package">
          <h2 id="test-package" className="title-card">
            {t("package.title")}
          </h2>
          <PackageExpectationsEditor
            key={`${test.updated_at}-${sortedTasks.map((x) => x.id).join(",")}`}
            testId={test.id}
            value={test.package_expectations}
            tasks={sortedTasks.map((x, i) => ({ id: x.id, number: i + 1, title: (locale === "ar" ? x.title_ar : x.title_en) || x.title_en, expected_upload: x.expected_upload }))}
          />
        </section>
      ) : null}

      {back}
    </div>
  );
}
