import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import type { PackageFile } from "@/components/cad-champions/test/package-panel";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { TestLoadProblem, renderBriefs } from "@/components/cad-champions/test/server-parts";
import { SubmittedScreen } from "@/components/cad-champions/test/submitted-screen";
import { TestWorkspace, type StoredFile } from "@/components/cad-champions/test/workspace";
import { PageHeader } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import {
  closeIfExpired,
  loadAttempts,
  loadLabels,
  loadSubmissions,
  loadTaskResults,
  loadTest,
} from "@/lib/cad-champions/test/server";
import { liveTaskState, type LiveTaskState } from "@/lib/cad-champions/test/status";
import { toTaskViews } from "@/lib/cad-champions/test/view";
import { isPackageManifest } from "@/lib/cad-champions/upload/package-check";

// Test workspace (Prompt 5 Step B) and, once handed in, the "Test submitted"
// screen (Step C). Every read here also runs the server-side auto-submit
// check: an attempt past deadline + grace is closed with reason "timeout".

// Grading runs in after() of the submit action (and of an auto-submit on
// read), within this route's time budget.
export const maxDuration = 300;

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.test" });
  return ccPageMetadata({ locale, path: `/test/${slug}/attempt`, title: t("workspace.metaTitle") });
}

export default async function CcTestAttemptPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, `/test/${slug}/attempt`));
  const t = await getTranslations({ locale, namespace: "CC.test" });

  const loaded = await loadTest(slug);
  if (!loaded.ok) {
    return (
      <div className="container py-8 sm:py-12">
        <TestLoadProblem locale={locale} reason={loaded.reason} />
      </div>
    );
  }
  const { test } = loaded;
  const attempts = await Promise.all((await loadAttempts(cc.user.id, test.id)).map((a) => closeIfExpired(a, test)));
  const current = attempts.find((a) => a.status === "in_progress") ?? attempts[0] ?? null;
  if (!current) redirect(ccPath(locale, `/test/${slug}`));

  const labels = await loadLabels();
  const tasks = toTaskViews(loaded.tasks, labels, locale, test.package_expectations);
  const title = (locale === "ar" ? test.title_ar : test.title_en) || test.title_en;
  const subs = await loadSubmissions(current.id);

  if (current.status !== "in_progress") {
    const results = new Map((await loadTaskResults(current.id)).map((r) => [r.task_id, r]));
    const hasPackage = subs.some((s) => s.task_id == null);
    const uploaded = new Set(subs.map((s) => s.task_id));
    const initial: Record<string, LiveTaskState> = {};
    for (const task of tasks) {
      const r = results.get(task.id);
      const hasFile = r ? r.submission_id != null : uploaded.has(task.id) || hasPackage;
      initial[task.id] = liveTaskState({ hasFile, resultStatus: r?.status ?? null, gradingMode: task.gradingMode });
    }
    return (
      <div className="container space-y-6 py-8 sm:py-12">
        <PageHeader title={title} purpose={t("submitted.purpose")} />
        <div className="max-w-3xl">
          <SubmittedScreen
            attemptId={current.id}
            tasks={tasks.map((x) => ({ id: x.id, number: x.number, title: x.title }))}
            initial={initial}
            submittedAt={current.submitted_at}
            submitReason={current.submit_reason}
            hasDrawings={tasks.some((x) => x.gradingMode !== "auto_step")}
          />
        </div>
        <SignedInExtras pageName={t("submitted.title")} />
      </div>
    );
  }

  const submissions: Record<string, StoredFile> = {};
  let pkg: PackageFile | null = null;
  for (const s of subs) {
    if (s.task_id) submissions[s.task_id] = { fileName: s.file_name, size: s.file_size, uploadedAt: s.uploaded_at };
    else pkg = { fileName: s.file_name, size: s.file_size, uploadedAt: s.uploaded_at, manifest: isPackageManifest(s.package_manifest) ? s.package_manifest : null };
  }

  return (
    <div className="container space-y-6 py-6 sm:py-8">
      <PageHeader title={title} purpose={t("workspace.purpose")} />
      <TestWorkspace
        mode="live"
        testTitle={title}
        uploadMode={test.upload_mode}
        graceSeconds={test.grace_seconds}
        timeLimitMinutes={test.time_limit_minutes}
        attempt={{
          id: current.id,
          startedAt: current.started_at,
          deadlineAt: current.deadline_at,
          inPerson: current.in_person,
          phaseMarkers: Array.isArray(current.phase_markers) ? current.phase_markers : [],
        }}
        userId={cc.user.id}
        tasks={tasks}
        briefs={renderBriefs(loaded.tasks, locale)}
        submissions={submissions}
        packageFile={pkg}
        serverNow={Date.now()}
      />
      <SignedInExtras pageName={title} />
    </div>
  );
}
