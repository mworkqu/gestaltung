import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OnboardingClient } from "@/app/[locale]/cad-champions/onboarding/onboarding-client";
import { ArticleBody } from "@/components/cad-champions/help/article-body";
import { GetReadyHub } from "@/components/cad-champions/get-ready/hub";
import { AdminPaymentCard } from "@/components/cad-champions/payments/admin-payment-card";
import { CheckoutClient } from "@/components/cad-champions/payments/checkout-client";
import { FawranPay } from "@/components/cad-champions/payments/fawran-pay";
import { Expired, FullResults } from "@/components/cad-champions/results/results-sections";
import { ReviewWorkspace } from "@/components/cad-champions/review/review-workspace";
import { TestIntro } from "@/components/cad-champions/test/intro-sections";
import { StartPanel, type StartPanelState } from "@/components/cad-champions/test/start-panel";
import { SubmittedScreen } from "@/components/cad-champions/test/submitted-screen";
import { TestWorkspace } from "@/components/cad-champions/test/workspace";
import { Alert, NeedHelpButton, PageHeader, StatusChip, Stepper, type StepperStep } from "@/components/cad-champions/ui";
import { ExerciseWorkspace } from "@/components/cad-champions/training/exercise-workspace";
import { LessonPlayer } from "@/components/cad-champions/video/lesson-player";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";
import { journeySteps, nextStep } from "@/lib/cad-champions/journey/next-step";
import { canSeeSolution, canWatchLesson, hintsAvailable } from "@/lib/cad-champions/training/access";
import { isCcLocale } from "@/lib/cad-champions/routes";
import { getCcContact } from "@/lib/cad-champions/site-contact";

import { FixtureUploads } from "./fixture-client";
import {
  DASHBOARD_STATES,
  FIXTURES,
  FX,
  GET_READY_ALMOST_DONE,
  RESULT_VARIANTS,
  SAMPLE_COHORTS,
  SAMPLE_PAYMENT_CARD,
  SAMPLE_PLANS,
  SAMPLE_REVIEW,
  sampleFawran,
  sampleResults,
  sampleTasks,
  sampleTest,
  type DashboardState,
  type ResultVariant,
} from "./fixture-data";

// TEST-ONLY (lib/e2e-fixtures.ts): the CAD Champions screens that need a
// signed-in session, rendered with STATIC sample props so the read-only e2e
// suite (e2e/cad-champions/*.spec.ts) can walk the journey without signing in
// or touching the database. Public URL: /cad-champions/{en,ar}/e2e-fixtures/<name>
// (the CC layout + CC messages apply; the path is not in CC_PROTECTED_PREFIXES).
// Every server action a component calls is intercepted by the spec
// (e2e/cad-champions/cc.ts mocks the Next-Action POST; an unmocked one is
// aborted and fails the test) — nothing here reaches a real action. Uploads
// go through FixtureUploads (in memory, never Supabase Storage).
// Query switches: dashboard ?state=new|ready|testing|results|enrolled,
// get-ready ?keys=practice, test-intro ?gate=locked|ready|cooldown|continue,
// workspace ?mode=per_task|module_package&left=<seconds>,
// results ?variant=weak|medium|strong|provisional|expired&offer=video, exercise ?attempts=N,
// any fixture ?help=1 (Need help button; the walkthrough video, scripts/record-videos/cc).
// 404 unless E2E_FIXTURES=1 and not on Vercel.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ locale: string; fixture: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

type Query = Record<string, string | undefined>;

export default async function CcE2eFixturePage({ params, searchParams }: Props) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale, fixture } = await params;
  if (!isCcLocale(locale) || !(FIXTURES as readonly string[]).includes(fixture)) notFound();
  setRequestLocale(locale);
  const raw = await searchParams;
  const query: Query = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

  return (
    <FixtureUploads>
      <div className="container space-y-6 py-8 sm:py-12" data-testid={`cc-fixture-${fixture}`}>
        {await body(fixture as (typeof FIXTURES)[number], locale, query)}
      </div>
      {/* ?help=1: the signed-in "Need help?" button (normally only with a CC session). */}
      {query.help === "1" ? <NeedHelpButton pageName={fixture} {...needHelpContact()} /> : null}
    </FixtureUploads>
  );
}

/**
 * ?offer=video on the results fixture: the walkthrough video (scripts/record-videos/cc)
 * shows the training card with NO price (prices are never shown in public videos)
 * and the sample text in the page language.
 */
function videoOffer(locale: "en" | "ar") {
  const ar = locale === "ar";
  return {
    lesson: { slug: "e2e-free-lesson", title: ar ? "قيود الرسم في 10 دقائق" : "Sketch constraints in 10 minutes", minutes: 10 },
    plan: {
      name: ar ? "التدريب عبر الإنترنت" : "Online training",
      priceQar: null,
      durationDays: null,
      includes: ar ? ["دروس لكل مستوى من المستويات الستة", "تمارين تدريبية مع تصحيح"] : ["Lessons for each of the six levels", "Practice exercises with marking"],
    },
  };
}

function needHelpContact() {
  const { whatsappNumber, supportEmail } = getCcContact();
  return { whatsappNumber, supportEmail };
}

function startState(gate: string | undefined): StartPanelState {
  switch (gate) {
    case "locked":
      return { kind: "locked", reason: "not_finished", remaining: 2 };
    case "cooldown":
      return { kind: "cooldown", retakeAt: Date.parse("2030-01-15T09:00:00Z"), days: 30 };
    case "continue":
      return { kind: "continue", secondsLeft: 42 * 60 };
    default:
      return { kind: "start", minutes: 90 };
  }
}

async function body(fixture: (typeof FIXTURES)[number], locale: "en" | "ar", query: Query) {
  switch (fixture) {
    case "dashboard": {
      // The real dashboard cards read the database; this renders the same "next step" and
      // tracker from the real pure helpers (lib/cad-champions/journey/next-step.ts).
      const key = (query.state && query.state in DASHBOARD_STATES ? query.state : "new") as DashboardState;
      const sample = DASHBOARD_STATES[key];
      const t = await getTranslations({ locale, namespace: "CC.dashboard" });
      const tPages = await getTranslations({ locale, namespace: "CC.pages" });
      const step = nextStep(sample.journey, sample.profile, sample.attempt, locale);
      const steps: StepperStep[] = journeySteps(sample.journey, sample.profile, sample.attempt).map((x) => ({
        id: x.id,
        label: t(`tracker.steps.${x.id}.label`),
        description: t(`tracker.steps.${x.id}.desc`),
        status: x.status,
        lockedReason: x.lockedReasonKey ? t(`tracker.locked.${x.lockedReasonKey}`) : undefined,
      }));
      return (
        <>
          <PageHeader title={tPages("dashboard.title")} purpose={tPages("dashboard.purpose")} />
          <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-next-step-heading" data-testid="next-step" data-step={step.id}>
            <h2 id="cc-next-step-heading" className="kicker">
              {t("nextStep.kicker")}
            </h2>
            <p className="max-w-2xl text-xl font-bold text-heading sm:text-2xl">{t(`nextStep.reason.${step.reasonKey}`)}</p>
            <a href={step.href} className="font-semibold text-accent">
              {t(`nextStep.cta.${step.ctaKey}`)}
            </a>
          </section>
          <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-tracker-heading" data-testid="tracker">
            <h2 id="cc-tracker-heading" className="text-xl font-extrabold text-heading">
              {t("tracker.title")}
            </h2>
            <Stepper steps={steps} />
          </section>
        </>
      );
    }

    case "onboarding":
      return <OnboardingClient startScreen={0} initialTrack="inventor" />;

    case "get-ready":
      return (
        <GetReadyHub
          userId={FX.userId}
          initialKeys={query.keys === "practice" ? GET_READY_ALMOST_DONE : ["welcome_video"]}
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
          action={<StartPanel slug={test.slug} state={startState(query.gate)} last={null} />}
        />
      );
    }

    case "workspace": {
      const now = Date.now();
      const uploadMode = query.mode === "per_task" ? "per_task" : "module_package";
      const left = query.left && Number.isFinite(Number(query.left)) ? Number(query.left) : 85 * 60;
      return (
        <TestWorkspace
          mode="live"
          testTitle="Sample diagnostic test"
          uploadMode={uploadMode}
          graceSeconds={120}
          timeLimitMinutes={90}
          attempt={{
            id: FX.attemptId,
            startedAt: new Date(now - 5 * 60_000).toISOString(),
            deadlineAt: new Date(now + left * 1000).toISOString(),
            inPerson: false,
            phaseMarkers: [],
          }}
          userId={FX.userId}
          tasks={sampleTasks(uploadMode)}
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
      const variant = ((RESULT_VARIANTS as readonly string[]).includes(query.variant ?? "") ? query.variant : "medium") as ResultVariant;
      const v = sampleResults(locale, names, variant);
      const t = await getTranslations({ locale, namespace: "CC.results" });
      if (v.status === "expired") {
        return (
          <>
            <PageHeader title={v.test.title} purpose={t("page.purpose")} />
            <div className="max-w-4xl space-y-6">
              <Expired v={v} locale={locale} />
            </div>
          </>
        );
      }
      return (
        <>
          <PageHeader title={v.test.title} purpose={t("page.purpose")} />
          <div className="max-w-4xl space-y-6">
            <FullResults
              v={v}
              locale={locale}
              isOwner={false}
              offer={query.offer === "video" ? videoOffer(locale) : {
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

    case "exercise": {
      // ?attempts=N failed graded attempts: hints open one per failed attempt (the real rule).
      const attempts = Math.max(0, Math.min(10, Math.floor(Number(query.attempts ?? 0)) || 0));
      return (
        <>
          <PageHeader title="Sample L1 exercise: bracket" purpose="Foundations · Level 1" />
          <ExerciseWorkspace
            slug="e2e-l1-bracket"
            exerciseId={FX.exerciseId}
            userId={FX.userId}
            accept="step"
            passMark={80}
            hintCount={3}
            hasSolution
            initial={{
              best: attempts > 0 ? 40 : null,
              attempts,
              failed: attempts,
              passed: false,
              hintsAvailable: hintsAvailable(attempts, 3),
              solutionUnlocked: canSeeSolution({ hasVideo: true, passed: false, attempts }),
            }}
          />
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
