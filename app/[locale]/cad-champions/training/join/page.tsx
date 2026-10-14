import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap, MessageCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { BackToTraining } from "@/components/cad-champions/training/page-bits";
import { Button, PageHeader } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";

// Placeholder join page (Prompt 10 builds plans + payment here).

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return ccPageMetadata({ locale, path: "/training/join", title: t("join") });
}

export default async function CcTrainingJoinPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcUser(locale, ccPath(locale, "/training/join"));
  const t = await getTranslations({ locale, namespace: "CC.training.join" });
  const { whatsappNumber, supportEmail } = getCcContact();
  const wa = buildWhatsAppUrl(whatsappNumber, t("title"));

  return (
    <div className="container page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} actions={<BackToTraining locale={locale} />} />
      <section className="neu space-y-3 p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <GraduationCap aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <p className="text-base font-bold text-ink">{t("plans")}</p>
        </div>
        <p className="text-sm text-body">
          <span className="font-semibold text-ink">{t("freeTitle")}: </span>
          {t("free")}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={ccPath(locale, "/training")}>{t("freeTitle")}</Link>
          </Button>
          <Button asChild variant="ghost">
            <a href={wa ?? `mailto:${supportEmail}`} target={wa ? "_blank" : undefined} rel={wa ? "noopener noreferrer" : undefined}>
              <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              {t("questions")}
            </a>
          </Button>
        </div>
      </section>
      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
