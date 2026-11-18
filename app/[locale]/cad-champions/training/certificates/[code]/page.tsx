import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, SearchX } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { BackToTraining } from "@/components/cad-champions/training/page-bits";
import { Button, EmptyState, PageHeader } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { loadOwnCertificate, verifyUrl } from "@/lib/cad-champions/training/certificate-server";

// Certificate preview + PDF / printable HTML download (Prompt 9 Step E).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, code } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return ccPageMetadata({ locale, path: `/training/certificates/${code}`, title: t("certificate") });
}

export default async function CcCertificatePage({ params }: Props) {
  const { locale, code } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcUser(locale, ccPath(locale, `/training/certificates/${code}`));
  const t = await getTranslations({ locale, namespace: "CC.training.certificate" });
  const cert = await loadOwnCertificate(code, locale);
  const other: Locale = locale === "ar" ? "en" : "ar";

  if (!cert) {
    return (
      <div className="container page-stack">
        <PageHeader title={t("title")} purpose={t("purpose")} actions={<BackToTraining locale={locale} />} />
        <EmptyState icon={SearchX} title={t("notFoundTitle")} description={t("notFoundText")} />
        <SignedInExtras pageName={t("title")} />
      </div>
    );
  }

  const href = (lang: Locale) => `/api/cad-champions/certificates/${cert.code}?lang=${lang}`;
  return (
    <div className="container page-stack">
      <PageHeader
        title={t("title")}
        purpose={t("purpose")}
        actions={
          <>
            <Button asChild>
              <a href={href(locale)}>
                <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                {t("download")}
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={href(other)}>{t("downloadOther")}</a>
            </Button>
            <BackToTraining locale={locale} />
          </>
        }
      />

      <section className="neu mx-auto max-w-4xl p-4 sm:p-8" aria-label={t("heading")}>
        <div className="rounded-xl border-4 border-accent bg-white p-6 text-center sm:p-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent rtl:normal-case rtl:tracking-normal">{t("brand")}</p>
          <h2 className="mt-3 text-2xl font-extrabold text-heading sm:text-4xl">{t("heading")}</h2>
          <p className="mt-6 text-sm text-body">{t("awardedTo")}</p>
          <p className="mt-1 text-2xl font-bold text-ink sm:text-3xl">{cert.studentName ?? t("noName")}</p>
          <p className="mt-6 text-sm text-body">{t("forCompleting")}</p>
          <p className="mt-1 text-xl font-bold text-ink">{cert.moduleTitle}</p>
          <dl className="mt-8 grid gap-4 text-start text-sm sm:grid-cols-3">
            <div>
              <dt className="text-body">{t("issued")}</dt>
              <dd className="font-bold text-ink">{formatDate(cert.issuedAt, locale)}</dd>
            </div>
            <div>
              <dt className="text-body">{t("code")}</dt>
              <dd className="font-bold text-ink">
                <Ltr>{cert.code}</Ltr>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-body">{t("verifyAt")}</dt>
              <dd className="break-all font-bold text-ink">
                <Ltr>{verifyUrl(locale, cert.code)}</Ltr>
              </dd>
            </div>
          </dl>
          <p className="mt-6 text-xs text-mutedtext">{t("disclaimer")}</p>
        </div>
      </section>

      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
