import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { TestIntro } from "@/components/cad-champions/test/intro-sections";
import { TestLoadProblem, renderBriefs } from "@/components/cad-champions/test/server-parts";
import { TestWorkspace } from "@/components/cad-champions/test/workspace";
import { Alert, PageHeader } from "@/components/cad-champions/ui";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { loadLabels, loadTest } from "@/lib/cad-champions/test/server";
import { toTaskViews } from "@/lib/cad-champions/test/view";

// Admin preview (Prompt 5 Step F): the intro and the test screen exactly as a
// student sees them, read-only. No attempt is created, the timer does not
// run, uploads and Submit are off. Staff only (instructor or admin); staff
// see unpublished and staff-only tests through RLS.

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.test" });
  return ccPageMetadata({ locale, path: `/admin/tests/${slug}/preview`, title: t("preview.metaTitle") });
}

export default async function CcAdminTestPreviewPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcStaff(locale, ccPath(locale, `/admin/tests/${slug}/preview`));
  const t = await getTranslations({ locale, namespace: "CC.test" });

  const back = (
    <Link href={ccPath(locale, "/test")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
      <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
      {t("problem.back")}
    </Link>
  );

  const loaded = await loadTest(slug);
  if (!loaded.ok) {
    return (
      <div className="container space-y-6 py-8 sm:py-12">
        {back}
        <TestLoadProblem locale={locale} reason={loaded.reason} />
      </div>
    );
  }
  const { test } = loaded;
  const labels = await loadLabels();
  const tasks = toTaskViews(loaded.tasks, labels, locale, test.package_expectations);
  const title = (locale === "ar" ? test.title_ar : test.title_en) || test.title_en;

  return (
    <div className="container space-y-8 py-8 sm:py-12">
      {back}
      <PageHeader title={t("preview.title", { title })} purpose={t("preview.purpose")} />
      <Alert tone="info" title={t("preview.bannerTitle")}>
        <span className="inline-flex items-center gap-2">
          <Eye aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
          {t("preview.banner")}
        </span>
      </Alert>

      <section aria-labelledby="cc-preview-intro" className="space-y-4">
        <h2 id="cc-preview-intro" className="text-2xl font-extrabold text-heading">
          {t("preview.introHeading")}
        </h2>
        <div className="max-w-4xl">
          <TestIntro locale={locale} test={test} tasks={tasks} />
        </div>
      </section>

      <section aria-labelledby="cc-preview-workspace" className="space-y-4">
        <h2 id="cc-preview-workspace" className="text-2xl font-extrabold text-heading">
          {t("preview.workspaceHeading")}
        </h2>
        <TestWorkspace
          mode="preview"
          testTitle={title}
          uploadMode={test.upload_mode}
          graceSeconds={test.grace_seconds}
          timeLimitMinutes={test.time_limit_minutes}
          attempt={null}
          userId={cc.user.id}
          tasks={tasks}
          briefs={renderBriefs(loaded.tasks, locale)}
          submissions={{}}
          packageFile={null}
          serverNow={Date.now()}
        />
      </section>

      <SignedInExtras pageName={t("preview.metaTitle")} />
    </div>
  );
}
