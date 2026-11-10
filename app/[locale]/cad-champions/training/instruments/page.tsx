import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, MessageCircle, PlayCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { BackToTraining } from "@/components/cad-champions/training/page-bits";
import { Button, PageHeader, Term } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";
import { INSTRUMENTS } from "@/lib/cad-champions/training/catalog";

// Instruments page (COMPETITION_ALIGNMENT section G): each allowed measuring
// instrument with a photo slot [TODO-MO], what it measures and a short lesson.

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return ccPageMetadata({ locale, path: "/training/instruments", title: t("instruments") });
}

export default async function CcInstrumentsPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcUser(locale, ccPath(locale, "/training/instruments"));
  const t = await getTranslations({ locale, namespace: "CC.training.instruments" });
  const { whatsappNumber, supportEmail } = await getCcContact();
  const wa = buildWhatsAppUrl(whatsappNumber, t("kitTitle"));

  return (
    <div className="container page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} actions={<BackToTraining locale={locale} />} />
      <p className="max-w-3xl text-base text-body">
        {t("intro")} <Term id="reverse-engineering" />
      </p>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {INSTRUMENTS.map((x) => (
          <li key={x.key} className="neu flex flex-col gap-3 p-5">
            <div className="neu-inset flex aspect-[4/3] items-center justify-center rounded-xl" role="img" aria-label={t("photo")}>
              <span className="flex flex-col items-center gap-1 text-xs text-mutedtext">
                <Camera aria-hidden="true" strokeWidth={1.5} className="h-7 w-7" />
                {t("photo")}
              </span>
            </div>
            <h2 className="title-card">{t(`items.${x.key}.name`)}</h2>
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="font-semibold text-ink">{t("measures")}</dt>
                <dd className="text-body">{t(`items.${x.key}.measures`)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">{t("range")}</dt>
                <dd className="text-body" dir="auto">
                  {t(`items.${x.key}.range`)}
                </dd>
              </div>
            </dl>
            <div className="mt-auto">
              <Button asChild variant="secondary" size="sm">
                <Link href={ccPath(locale, `/training/lessons/${x.lessonSlug}`)}>
                  <PlayCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                  {t("lesson")}
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <section className="neu space-y-2 p-6" aria-labelledby="cc-also">
        <h2 id="cc-also" className="title-card">
          {t("alsoTitle")}
        </h2>
        <p className="text-sm text-body">{t("also")}</p>
      </section>

      <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="cc-kit">
        <h2 id="cc-kit" className="title-section">
          {t("kitTitle")}
        </h2>
        <p className="text-sm text-body">{t("kitText")}</p>
        <Button asChild variant="secondary">
          <a href={wa ?? `mailto:${supportEmail}`} target={wa ? "_blank" : undefined} rel={wa ? "noopener noreferrer" : undefined}>
            <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("kitCta")}
          </a>
        </Button>
      </section>

      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
