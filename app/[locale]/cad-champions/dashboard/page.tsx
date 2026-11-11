import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";
import { Alert, Button, PageHeader, SkeletonCard } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { isOnboardingSkipped } from "@/lib/cad-champions/profile/onboarding";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

import { NextStepSection, ProfileCardSection, ProgressSection, TestCardSection, TrackerSection, TrainingCardSection } from "./sections";

export const generateMetadata = placeholderMetadata("dashboard", "/dashboard");

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function CcDashboardPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);

  const { user, profile } = await requireCcUser(locale, ccPath(locale, "/dashboard"));

  // First sign-in goes to onboarding, unless the student skipped it (?skip=1 or a stored skip).
  const query = await searchParams;
  const skipFlag = query.skip === "1";
  const onboardingOpen = Boolean(profile) && !profile?.onboarding_completed_at;
  if (onboardingOpen && !skipFlag && !isOnboardingSkipped(profile?.onboarding_step)) {
    redirect(ccPath(locale, "/onboarding"));
  }

  const t = await getTranslations({ locale, namespace: "CC.dashboard" });
  const tPages = await getTranslations({ locale, namespace: "CC.pages" });
  const tAccount = await getTranslations({ locale, namespace: "CC.account" });

  const firstName = profile?.full_name?.trim().split(/\s+/)[0];
  const common = { userId: user.id, profile, locale };

  return (
    <div className="container py-8 sm:py-12">
      <PageHeader title={tPages("dashboard.title")} purpose={tPages("dashboard.purpose")} />

      <div className="mt-8 space-y-6">
        <p className="text-lg font-semibold text-ink">{firstName ? t("greeting", { name: firstName }) : t("greetingNoName")}</p>

        {!profile ? (
          <Alert tone="warning" title={tAccount("noProfileTitle")}>
            {tAccount("noProfileText")}
          </Alert>
        ) : null}

        {onboardingOpen ? (
          <section className="neu flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="cc-finish-onboarding">
            <div>
              <h2 id="cc-finish-onboarding" className="text-lg font-extrabold text-heading">
                {t("finishOnboarding.title")}
              </h2>
              <p className="mt-1 text-sm text-body">{t("finishOnboarding.body")}</p>
            </div>
            <Button asChild variant="secondary">
              <Link href={ccPath(locale, "/onboarding")}>{t("finishOnboarding.cta")}</Link>
            </Button>
          </section>
        ) : null}

        <Suspense fallback={<SkeletonCard />}>
          <NextStepSection {...common} />
        </Suspense>

        <Suspense fallback={<SkeletonCard />}>
          <TrackerSection {...common} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-3">
          <Suspense fallback={<SkeletonCard />}>
            <TestCardSection {...common} />
          </Suspense>
          <Suspense fallback={<SkeletonCard />}>
            <TrainingCardSection userId={user.id} locale={locale} />
          </Suspense>
          <Suspense fallback={<SkeletonCard />}>
            <ProfileCardSection profile={profile} locale={locale} />
          </Suspense>
        </div>

        <Suspense fallback={<SkeletonCard />}>
          <ProgressSection userId={user.id} locale={locale} />
        </Suspense>
      </div>

      <SignedInExtras pageName={tPages("dashboard.title")} />
    </div>
  );
}
