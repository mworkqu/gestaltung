import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, SearchX } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { GradingPoller } from "@/components/cad-champions/results/grading-poller";
import { Expired, FullResults, InProgress } from "@/components/cad-champions/results/results-sections";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, Button, EmptyState, PageHeader } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { markJourney } from "@/lib/cad-champions/journey/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { loadResultsView } from "@/lib/cad-champions/scoring/load";
import { computeAttemptScores } from "@/lib/cad-champions/scoring/server";

// Results page (Prompt 7 Step B + C). Owner or staff only. States: still
// grading (live poll), grading error (manual check), expired with no files,
// in progress, and the full results with skill map, module readiness, task
// feedback, training path, offer and share link.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; attemptId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, attemptId } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.results.page" });
  return ccPageMetadata({ locale, path: `/results/${attemptId}`, title: t("metaTitle") });
}

export default async function CcResultsAttemptPage({ params }: Props) {
  const { locale, attemptId } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, `/results/${attemptId}`));
  const t = await getTranslations({ locale, namespace: "CC.results" });

  let loaded = await loadResultsView(attemptId, locale);
  const owns = loaded.ok && (loaded.view.userId === cc.user.id || cc.isStaff);

  // Self-heal: every task has a result row and nothing is left for the grader,
  // but the attempt still says "grading" (scores never written). Compute now.
  if (
    loaded.ok &&
    owns &&
    (loaded.view.status === "submitted" || loaded.view.status === "grading") &&
    loaded.view.outcome !== "grading" &&
    loaded.view.tasks.length > 0 &&
    loaded.view.tasks.every((x) => x.taskResultId)
  ) {
    const res = await computeAttemptScores(attemptId);
    if (res.ok) loaded = await loadResultsView(attemptId, locale);
  }

  const back = (
    <Button asChild variant="ghost" size="sm">
      <Link href={ccPath(locale, "/results")}>
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("page.back")}
      </Link>
    </Button>
  );

  if (!loaded.ok || !owns) {
    const reason = !loaded.ok ? loaded.reason : "not_found";
    const key = reason === "not_set_up" ? "notSetUp" : reason === "not_found" ? "notFound" : "error";
    return (
      <div className="container space-y-6 py-8 sm:py-12">
        <PageHeader title={t("page.metaTitle")} purpose={t("page.purpose")} actions={back} />
        <EmptyState icon={SearchX} title={t(`page.${key}Title`)} description={t(`page.${key}Text`)} />
        <SignedInExtras pageName={t("page.metaTitle")} />
      </div>
    );
  }

  const v = loaded.view;
  const isOwner = v.userId === cc.user.id;
  const finished = v.status === "provisional" || v.status === "graded";
  if (finished && isOwner) await markJourney(cc.user.id, "results_viewed_at");

  return (
    <div className="container space-y-6 py-8 sm:py-12">
      <PageHeader title={v.test.title} purpose={t("page.purpose")} actions={back} />
      <div className="max-w-4xl space-y-6">
        {v.status === "in_progress" ? <InProgress v={v} locale={locale} /> : null}
        {v.status === "submitted" || v.status === "grading" ? (
          <>
            {v.anyManualCheck ? (
              <Alert tone="info" title={t("states.manualTitle")}>
                {t("states.manualText")}
              </Alert>
            ) : null}
            <GradingPoller attemptId={v.attemptId} tasks={v.tasks.map((x) => ({ id: x.id, number: x.number, title: x.title }))} />
          </>
        ) : null}
        {v.status === "expired" ? <Expired v={v} locale={locale} /> : null}
        {finished ? <FullResults v={v} locale={locale} isOwner={isOwner} /> : null}
      </div>
      <SignedInExtras pageName={t("page.metaTitle")} />
    </div>
  );
}
