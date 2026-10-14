import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { GetReadyHub } from "@/components/cad-champions/get-ready/hub";
import { placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { readGetReadySteps } from "@/lib/cad-champions/get-ready/server";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";

// Get Ready hub (Prompt 4 Steps A/B). Signed-in CC students only.
export const generateMetadata = placeholderMetadata("getReady", "/get-ready");

export default async function CcGetReadyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);

  const { user, profile } = await requireCcUser(locale, ccPath(locale, "/get-ready"));
  const t = await getTranslations({ locale, namespace: "CC.get-ready" });

  const read = await readGetReadySteps(user.id);
  const { whatsappNumber } = getCcContact();

  return (
    <div className="container py-8 sm:py-12">
      <PageHeader
        title={t("header.title")}
        purpose={t("header.purpose")}
        help={<HelpTip label={t("header.helpLabel")} learnMoreSlug="how-the-free-test-works">{t("header.help")}</HelpTip>}
      />

      <div className="mt-8 max-w-4xl">
        <GetReadyHub
          userId={user.id}
          initialKeys={read.ok ? read.keys : []}
          loadState={read.ok ? "ok" : read.reason === "not_set_up" ? "not_set_up" : "error"}
          track={profile?.track_software ?? null}
          hasWindowsPc={profile?.has_windows_pc ?? null}
          bypass={Boolean(profile?.get_ready_bypass)}
          noComputerWhatsappUrl={buildWhatsAppUrl(whatsappNumber, t("computer.noComputerWhatsapp"))}
          solidworksWhatsappUrl={buildWhatsAppUrl(whatsappNumber, t("software.solidworksWhatsapp"))}
        />
      </div>

      <SignedInExtras pageName={t("header.title")} />
    </div>
  );
}
