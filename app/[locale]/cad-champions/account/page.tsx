import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UserRound } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { EmptyState, PageHeader } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isCcTrack } from "@/lib/cad-champions/profile/track";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { createClient } from "@/lib/supabase/server";

import { DeletionSection, DetailsForm, EmailForm, LanguageForm, PasswordForm, SectionCard, TrackForm } from "./account-forms";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.account" });
  return ccPageMetadata({ locale, path: "/account", title: t("title") });
}

/** Created-at of the student's pending deletion request, or null. Never throws. */
async function pendingDeletionSince(userId: string, fallback: string | null): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cc_deletion_requests")
      .select("created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { created_at: string } | null)?.created_at ?? fallback;
  } catch (e) {
    console.error("[cc account] could not read deletion request", e instanceof Error ? e.message : e);
    return fallback;
  }
}

export default async function CcAccountPage({ params }: Params) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);

  const { user, profile } = await requireCcUser(locale, ccPath(locale, "/account"));
  const t = await getTranslations({ locale, namespace: "CC.account" });

  if (!profile) {
    return (
      <div className="container py-8 sm:py-12">
        <PageHeader title={t("title")} purpose={t("purpose")} />
        <div className="mt-8">
          <EmptyState icon={UserRound} title={t("noProfileTitle")} description={t("noProfileText")} />
        </div>
        <SignedInExtras pageName={t("title")} />
      </div>
    );
  }

  const pendingSince = await pendingDeletionSince(user.id, profile.deletion_requested_at);
  const track = isCcTrack(profile.track_software) ? profile.track_software : "inventor";

  return (
    <div className="container max-w-4xl py-8 sm:py-12">
      <PageHeader title={t("title")} purpose={t("purpose")} />

      <div className="mt-8 space-y-6">
        <SectionCard id="cc-details" title={t("details.title")} purpose={t("details.purpose")}>
          <DetailsForm
            initial={{
              fullName: profile.full_name ?? "",
              fullNameAr: profile.full_name_ar ?? "",
              phone: profile.phone ?? "",
              studyLevel: profile.study_level ?? "",
              cadSoftwareUsed: profile.cad_software_used ?? "",
              cadExperience: profile.cad_experience ?? "",
              computer: profile.has_windows_pc ?? "",
            }}
          />
        </SectionCard>

        <SectionCard
          id="cc-language"
          title={t("language.title")}
          purpose={t("language.purpose")}
          help={{ label: t("language.helpLabel"), text: t("language.help") }}
        >
          <LanguageForm initial={locale} />
        </SectionCard>

        <SectionCard
          id="cc-track"
          title={t("track.title")}
          purpose={t("track.purpose")}
          help={{ label: t("track.helpLabel"), text: t("track.help") }}
        >
          <TrackForm initial={track} />
        </SectionCard>

        <SectionCard id="cc-email" title={t("email.title")} purpose={t("email.purpose")}>
          <EmailForm initial={{ weekly: profile.weekly_progress_email, marketing: profile.marketing_consent }} />
        </SectionCard>

        <SectionCard id="cc-password" title={t("password.title")} purpose={t("password.purpose")}>
          <PasswordForm />
        </SectionCard>

        <SectionCard
          id="cc-deletion"
          title={t("deletion.title")}
          purpose={t("deletion.purpose")}
          help={{ label: t("deletion.helpLabel"), text: t("deletion.help") }}
        >
          <DeletionSection pendingSince={pendingSince} />
        </SectionCard>
      </div>

      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
