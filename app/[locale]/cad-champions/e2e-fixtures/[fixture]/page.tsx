import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OnboardingClient } from "@/app/[locale]/cad-champions/onboarding/onboarding-client";
import { ArticleBody } from "@/components/cad-champions/help/article-body";
import { GetReadyHub } from "@/components/cad-champions/get-ready/hub";
import { AdminPaymentCard } from "@/components/cad-champions/payments/admin-payment-card";
import { CheckoutClient } from "@/components/cad-champions/payments/checkout-client";
import { FawranPay } from "@/components/cad-champions/payments/fawran-pay";
import { FullResults } from "@/components/cad-champions/results/results-sections";
import { ReviewWorkspace } from "@/components/cad-champions/review/review-workspace";
import { TestIntro } from "@/components/cad-champions/test/intro-sections";
import { StartPanel } from "@/components/cad-champions/test/start-panel";
import { SubmittedScreen } from "@/components/cad-champions/test/submitted-screen";
import { TestWorkspace } from "@/components/cad-champions/test/workspace";
import { Alert, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import { LessonPlayer } from "@/components/cad-champions/video/lesson-player";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";
import { canWatchLesson } from "@/lib/cad-champions/training/access";
import { isCcLocale } from "@/lib/cad-champions/routes";

import { FIXTURES, FX, SAMPLE_COHORTS, SAMPLE_PAYMENT_CARD, SAMPLE_PLANS, SAMPLE_REVIEW, sampleFawran, sampleResults, sampleTasks, sampleTest } from "./fixture-data";

// TEST-ONLY (lib/e2e-fixtures.ts): the CAD Champions screens that need a
// signed-in session, rendered with STATIC sample props so the read-only e2e
// suite (e2e/cad-champions/*.spec.ts) can walk the journey without signing in
// or touching the database. Public URL: /cad-champions/{en,ar}/e2e-fixtures/<name>
// (the CC layout + CC messages apply; the path is not in CC_PROTECTED_PREFIXES).
// Every server action a component calls is intercepted by the spec
// (page.route on the Next-Action POST) — nothing here reaches a real action.
// 404 unless E2E_FIXTURES=1 and not on Vercel.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ locale: string; fixture: string }> };

export default async function CcE2eFixturePage({ params }: Props) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale, fixture } = await params;
  if (!isCcLocale(locale) || !(FIXTURES as readonly string[]).includes(fixture)) notFound();
  setRequestLocale(locale);

  return (
    <div className="container space-y-6 py-8 sm:py-12" data-testid={`cc-fixture-${fixture}`}>
      {await body(fixture as (typeof FIXTURES)[number], locale)}
    </div>
  );
}

async function body(fixture: (typeof FIXTURES)[number], locale: "en" | "ar") {
  switch (fixture) {
    case "onboarding":
      return <OnboardingClient startScreen={0} initialTrack="inventor" />;

    case "get-ready":
      return (
        <GetReadyHub
          userId={FX.userId}
          initialKeys={["welcome_video"]}
          loadState="ok"
          track="inventor"
          hasWindowsPc="yes"
          bypass={false}
          noComputerWhatsappUrl={null}
          solidworksWhatsappUrl={null}
        />
      );

    case "test-intro": {
      const test = sampleTest("module_package");
      return (
        <TestIntro
          locale={locale}
          test={test}
          tasks={sampleTasks("module_package")}
          action={<StartPanel slug={test.slug} state={{ kind: "start", minutes: test.time_limit_minutes }} last={null} />}
        />
      );
    }

    case "workspace": {
      const now = Date.now();
      return (
        <TestWorkspace
          mode="live"
          testTitle="Sample diagnostic test"
          uploadMode="module_package"
          graceSeconds={120}
          timeLimitMinutes={90}
          attempt={{
            id: FX.attemptId,
            startedAt: new Date(now - 5 * 60_000).toISOString(),
            deadlineAt: new Date(now + 85 * 60_000).toISOString(),
            inPerson: false,
            phaseMarkers: [],
          }}
          userId={FX.userId}
          tasks={sampleTasks("module_package")}
          briefs={{ [FX.task1]: <p>Model the bracket from the drawing.</p>, [FX.task2]: <p>Model the shaft from the drawing.</p> }}
          submissions={{}}
          packageFile={null}
          serverNow={now}
        />
      );
    }

    case "submitted":
      return (
        <SubmittedScreen
          attemptId={FX.attemptId}
          tasks={sampleTasks().map((x) => ({ id: x.id, number: x.number, title: x.title }))}
          initial={{ [FX.task1]: "checking", [FX.task2]: "checking" }}
          submittedAt="2026-10-14T07:20:00Z"
          submitReason="manual"
          hasDrawings={false}
        />
      );

    case "results": {
      const tShort = await getTranslations({ locale, namespace: "CC.results.areaShort" });
      const names = Object.fromEntries([1, 2, 3, 4, 5, 6].map((id) => [id, tShort(String(id) as "1")]));
      const v = sampleResults(locale, names);
      const t = await getTranslations({ locale, namespace: "CC.results" });
      return (
        <>
          <PageHeader title={v.test.title} purpose={t("page.purpose")} />
          <div className="max-w-4xl space-y-6">
            <FullResults
              v={v}
              locale={locale}
              isOwner={false}
              offer={{
                lesson: { slug: "e2e-free-lesson", title: "Sketch constraints in 10 minutes", minutes: 10 },
                plan: { name: "Online training (sample)", priceQar: 500, durationDays: 90, includes: ["All lessons", "Graded exercises"] },
              }}
            />
          </div>
        </>
      );
    }

    case "lesson": {
      const t = await getTranslations({ locale, namespace: "CC.training" });
      // The real rule: a student without the training may open a free-preview lesson only.
      const student = { enrolled: false, staff: false };
      const freeOpen = canWatchLesson(student, { is_free_preview: true, isOrientation: false });
      const paidOpen = canWatchLesson(student, { is_free_preview: false, isOrientation: false });
      return (
        <>
          <PageHeader title="Sketch constraints in 10 minutes" purpose="Foundations · Level 1" />
          <div className="flex flex-wrap gap-2">
            <StatusChip tone="success">{t("common.freePreview")}</StatusChip>
          </div>
          <section data-testid="lesson-free" className="space-y-4">
            {freeOpen ? (
              <>
                <LessonPlayer slug="e2e-free-lesson" title="Sketch constraints in 10 minutes" slot={null} resumeSecond={0} completed={false} />
                <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="cc-notes">
                  <h2 id="cc-notes" className="title-section">
                    {t("lesson.notes")}
                  </h2>
                  <ArticleBody markdown={"Fully constrain every sketch before you extrude it."} locale={locale} hasVideoId={false} />
                </section>
              </>
            ) : (
              <Alert tone="info" title={t("lesson.lockedTitle")}>
                {t("lesson.lockedText")}
              </Alert>
            )}
          </section>
          <section data-testid="lesson-paid">
            {paidOpen ? null : (
              <Alert tone="info" title={t("lesson.lockedTitle")}>
                {t("lesson.lockedText")}
              </Alert>
            )}
          </section>
        </>
      );
    }

    case "checkout":
      return <CheckoutClient plans={SAMPLE_PLANS} cohorts={SAMPLE_COHORTS} addon={null} initialPlanSlug={null} skipcashEnabled={false} />;

    case "fawran":
      return <FawranPay {...sampleFawran()} />;

    case "review":
      return <ReviewWorkspace view={SAMPLE_REVIEW} aiAvailable={false} />;

    case "payments":
      return <AdminPaymentCard p={SAMPLE_PAYMENT_CARD} />;
  }
}
