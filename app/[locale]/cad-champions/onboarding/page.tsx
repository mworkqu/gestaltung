import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/cad-champions/ui";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { onboardingStartScreen } from "@/lib/cad-champions/profile/onboarding";
import { defaultTrackFor } from "@/lib/cad-champions/profile/track";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

import { OnboardingClient } from "./onboarding-client";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.onboarding" });
  return ccPageMetadata({ locale, path: "/onboarding", title: t("title") });
}

export default async function CcOnboardingPage({ params }: Params) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);

  const { profile } = await requireCcUser(locale, ccPath(locale, "/onboarding"));
  // Onboarding is for the first sign-in only.
  if (profile?.onboarding_completed_at) redirect(ccPath(locale, "/dashboard"));

  const t = await getTranslations({ locale, namespace: "CC.onboarding" });
  // track_software defaults to inventor in the database, so it says nothing about a real choice yet.
  const initialTrack = defaultTrackFor(profile?.cad_software_used);

  return (
    <div className="container max-w-3xl py-8 sm:py-12">
      <PageHeader title={t("title")} purpose={t("purpose")} />
      <OnboardingClient startScreen={onboardingStartScreen(profile?.onboarding_step)} initialTrack={initialTrack} />
      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
