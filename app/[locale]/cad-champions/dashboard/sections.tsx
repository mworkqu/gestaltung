import Link from "next/link";
import { ArrowRight, FlaskConical, GraduationCap, UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Countdown } from "@/components/cad-champions/dashboard/countdown";
import { ProgressCard } from "@/components/cad-champions/results/progress-card";
import { DashboardTrainingStats } from "@/components/cad-champions/training/stats";
import { Alert, Button, EmptyState, HelpTip, StatusChip, Stepper, type ChipTone, type StepperStep } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { CcProfile } from "@/lib/cad-champions/db/types";
import { formatDate } from "@/lib/cad-champions/format";
import { journeySteps, nextStep } from "@/lib/cad-champions/journey/next-step";
import { testCardState, type TestCardState } from "@/lib/cad-champions/journey/test-status";
import { profileCompleteness } from "@/lib/cad-champions/profile/completeness";
import { ageEligibleUntilYear } from "@/lib/cad-champions/profile/eligibility";
import { ccPath } from "@/lib/cad-champions/routes";

import { loadDashboardData, type DashboardData } from "./data";

type Common = { userId: string; profile: CcProfile | null; locale: Locale };

/** Journey with the enrollment folded in (enrolled_at is written by the server, but an active enrollment is the truth). */
function effectiveJourney(data: DashboardData) {
  if (!data.journey && !data.enrollment) return null;
  return { ...data.journey, enrolled_at: data.journey?.enrolled_at ?? data.enrollment?.starts_at ?? null };
}

async function LoadError({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.dashboard.loadError" });
  return (
    <Alert tone="warning" title={t("title")}>
      {t("body")}
    </Alert>
  );
}

// ---------------------------------------------------------------- next step

export async function NextStepSection({ userId, profile, locale }: Common) {
  const t = await getTranslations({ locale, namespace: "CC.dashboard.nextStep" });
  const result = await loadDashboardData(userId);
  if (!result.ok) return <LoadError locale={locale} />;
  const step = nextStep(effectiveJourney(result.data), profile, result.data.attempt, locale);

  return (
    <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-next-step-heading">
      <div className="flex items-center gap-2">
        <h2 id="cc-next-step-heading" className="kicker">
          {t("kicker")}
        </h2>
        <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
      </div>
      <p className="max-w-2xl text-xl font-bold text-heading sm:text-2xl">{t(`reason.${step.reasonKey}`)}</p>
      <Button asChild>
        <Link href={step.href}>
          {t(`cta.${step.ctaKey}`)}
          <ArrowRight aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        </Link>
      </Button>
    </section>
  );
}

// ------------------------------------------------------------------ tracker

export async function TrackerSection({ userId, profile, locale }: Common) {
  const t = await getTranslations({ locale, namespace: "CC.dashboard.tracker" });
  const result = await loadDashboardData(userId);
  if (!result.ok) return <LoadError locale={locale} />;
  const steps: StepperStep[] = journeySteps(effectiveJourney(result.data), profile, result.data.attempt).map((s) => ({
    id: s.id,
    label: t(`steps.${s.id}.label`),
    description: t(`steps.${s.id}.desc`),
    status: s.status,
    lockedReason: s.lockedReasonKey ? t(`locked.${s.lockedReasonKey}`) : undefined,
  }));

  return (
    <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-tracker-heading">
      <div className="flex items-center gap-2">
        <h2 id="cc-tracker-heading" className="text-xl font-extrabold text-heading">
          {t("title")}
        </h2>
        <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
      </div>
      <Stepper steps={steps} />
    </section>
  );
}

// ---------------------------------------------------------------- test card

const TEST_CHIP: Record<TestCardState, { tone: ChipTone; key: string }> = {
  unavailable: { tone: "neutral", key: "notStarted" },
  locked: { tone: "neutral", key: "locked" },
  not_started: { tone: "neutral", key: "notStarted" },
  in_progress: { tone: "info", key: "inProgress" },
  time_up: { tone: "warning", key: "expired" },
  grading: { tone: "info", key: "grading" },
  ready: { tone: "success", key: "ready" },
  expired: { tone: "warning", key: "expired" },
};

export async function TestCardSection({ userId, profile, locale }: Common) {
  const t = await getTranslations({ locale, namespace: "CC.dashboard.test" });
  const tNext = await getTranslations({ locale, namespace: "CC.dashboard.nextStep.cta" });
  const result = await loadDashboardData(userId);
  if (!result.ok) return <LoadError locale={locale} />;
  const { data } = result;
  const journey = effectiveJourney(data);

  const tracker = journeySteps(journey, profile, data.attempt);
  const locked = tracker.find((s) => s.id === "free_test")?.status === "locked";
  const state = testCardState({ testAvailable: data.testAvailable, attempt: data.attempt, locked });
  const chip = TEST_CHIP[state];

  return (
    <section className="neu flex flex-col gap-4 p-6" aria-labelledby="cc-test-heading">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="cc-test-heading" className="text-lg font-extrabold text-heading">
            {t("title")}
          </h2>
          <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
        </div>
        {state !== "unavailable" ? <StatusChip tone={chip.tone}>{t(`status.${chip.key}`)}</StatusChip> : null}
      </div>

      {state === "unavailable" ? (
        <EmptyState icon={FlaskConical} title={t("unavailableTitle")} description={t("unavailableText")} />
      ) : null}

      {state === "locked" ? (
        <>
          <p className="text-sm text-body">{t("lockedText")}</p>
          <div>
            <Button asChild variant="secondary">
              <Link href={ccPath(locale, "/get-ready")}>{tNext("finish_get_ready")}</Link>
            </Button>
          </div>
        </>
      ) : null}

      {state === "not_started" ? (
        <>
          <p className="text-sm text-body">{t("notStartedText")}</p>
          <div>
            <Button asChild>
              <Link href={ccPath(locale, "/test")}>{t("open")}</Link>
            </Button>
          </div>
        </>
      ) : null}

      {(state === "in_progress" || state === "time_up") && data.attempt?.deadline_at ? (
        <>
          <p className="text-sm text-body">{t("inProgressText")}</p>
          <Countdown deadlineIso={data.attempt.deadline_at} />
          <div>
            <Button asChild>
              <Link href={ccPath(locale, "/test")}>{t("resume")}</Link>
            </Button>
          </div>
        </>
      ) : null}
      {state === "in_progress" && !data.attempt?.deadline_at ? (
        <>
          <p className="text-sm text-body">{t("inProgressText")}</p>
          <div>
            <Button asChild>
              <Link href={ccPath(locale, "/test")}>{t("resume")}</Link>
            </Button>
          </div>
        </>
      ) : null}

      {state === "grading" ? <p className="text-sm text-body">{t("gradingText")}</p> : null}

      {state === "ready" ? (
        <>
          <p className="text-sm text-body">{t("readyText")}</p>
          <div>
            <Button asChild>
              <Link href={ccPath(locale, "/results")}>{t("viewResults")}</Link>
            </Button>
          </div>
        </>
      ) : null}

      {state === "expired" ? (
        <>
          <p className="text-sm text-body">{t("expiredText")}</p>
          <div>
            <Button asChild variant="secondary">
              <Link href={ccPath(locale, "/test")}>{t("open")}</Link>
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------ progress card

/** "Your progress" (Prompt 7 Step E), shown under the test card row. */
export async function ProgressSection({ userId, locale }: Pick<Common, "userId" | "locale">) {
  return <ProgressCard userId={userId} locale={locale} />;
}

// ------------------------------------------------------------ training card

export async function TrainingCardSection({ userId, locale }: Pick<Common, "userId" | "locale">) {
  const t = await getTranslations({ locale, namespace: "CC.dashboard.training" });
  const result = await loadDashboardData(userId);
  if (!result.ok) return <LoadError locale={locale} />;
  const { enrollment, journey } = result.data;
  const resultsViewed = Boolean(journey?.results_viewed_at);

  return (
    <section className="neu flex flex-col gap-4 p-6" aria-labelledby="cc-training-heading">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="cc-training-heading" className="text-lg font-extrabold text-heading">
            {t("title")}
          </h2>
          <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
        </div>
        <StatusChip tone={enrollment ? "success" : "neutral"}>{enrollment ? t("activeStatus") : t("lockedStatus")}</StatusChip>
      </div>

      <DashboardTrainingStats userId={userId} locale={locale} />

      {enrollment ? (
        <>
          <p className="text-sm text-body">{t("activeUntil", { date: formatDate(enrollment.ends_at, locale) })}</p>
          <div>
            <Button asChild>
              <Link href={ccPath(locale, "/training")}>{t("open")}</Link>
            </Button>
          </div>
        </>
      ) : (
        <>
          <div>
            <p className="text-sm font-bold text-ink">{t("whatYouGet")}</p>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-body">
              <li>{t("bullets.one")}</li>
            </ul>
          </div>
          {resultsViewed ? (
            <div>
              <Button asChild variant="secondary">
                <Link href={ccPath(locale, "/training")}>{t("seeOptions")}</Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-body">{t("unlocksAfter")}</p>
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------- profile card

export async function ProfileCardSection({ profile, locale }: { profile: CcProfile | null; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.dashboard.profile" });
  const tElig = await getTranslations({ locale, namespace: "CC.dashboard.eligibility" });
  const { percent, missing } = profileCompleteness(profile);
  const untilYear = ageEligibleUntilYear(profile?.date_of_birth);

  return (
    <section className="neu flex flex-col gap-4 p-6" aria-labelledby="cc-profile-heading">
      <div className="flex items-center gap-2">
        <h2 id="cc-profile-heading" className="text-lg font-extrabold text-heading">
          {t("title")}
        </h2>
        <HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>
      </div>

      {!profile ? (
        <EmptyState
          icon={UserRound}
          title={t("emptyTitle")}
          description={t("emptyText")}
          action={
            <Button asChild variant="secondary">
              <Link href={ccPath(locale, "/account")}>{t("cta")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-ink">{t("percent", { percent })}</p>
            <div
              role="progressbar"
              aria-label={t("progressLabel")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 w-full overflow-hidden rounded-full bg-panel"
            >
              <div className="h-full rounded-full bg-accent" style={{ inlineSize: `${percent}%` }} />
            </div>
          </div>
          {missing.length === 0 ? (
            <p className="text-sm text-body">{t("complete")}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-body">{t("missingIntro")}</p>
              <ul className="flex flex-wrap gap-2">
                {missing.map((field) => (
                  <li key={field}>
                    <StatusChip tone="neutral">{t(`fields.${field}`)}</StatusChip>
                  </li>
                ))}
              </ul>
              <Button asChild variant="secondary">
                <Link href={ccPath(locale, "/account")}>{t("cta")}</Link>
              </Button>
            </div>
          )}

          <div className="flex items-start gap-2 border-t border-border pt-4 text-sm text-body">
            <GraduationCap aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <p>{untilYear ? tElig("line", { year: String(untilYear) }) : tElig("missing")}</p>
            <HelpTip label={tElig("helpLabel")}>{tElig("help")}</HelpTip>
          </div>
        </>
      )}
    </section>
  );
}
