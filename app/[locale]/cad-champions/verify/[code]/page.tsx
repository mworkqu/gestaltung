import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BadgeCheck, SearchX } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Alert, EmptyState, PageHeader } from "@/components/cad-champions/ui";
import { formatDate } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { CC_ROBOTS } from "@/lib/cad-champions/metadata";
import { ccRateLimited } from "@/lib/cad-champions/rate-limits";
import { isCcLocale } from "@/lib/cad-champions/routes";
import { verifyCertificate } from "@/lib/cad-champions/training/certificate-server";
import { clientIp } from "@/lib/rate-limit";

// Public certificate check (no sign-in, noindex). Reads ONLY the name, the
// module and the date through cc_verify_certificate(code) (0083).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.training.meta" });
  return { title: t("verify"), robots: CC_ROBOTS };
}

export default async function CcVerifyPage({ params }: Props) {
  const { locale, code } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "CC.training.verify" });
  // SR-L16: an IP limit so the page can't be used to walk the code space.
  const limited = ccRateLimited("verify", `ip:${clientIp(await headers())}`);
  const result = limited ? "limited" : await verifyCertificate(code, locale);

  return (
    <div className="container page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} />
      <div className="max-w-2xl">
        {result === "limited" ? (
          <Alert tone="warning" title={t("tooMany")} />
        ) : result === "unavailable" ? (
          <Alert tone="warning" title={t("unavailable")} />
        ) : !result ? (
          <EmptyState icon={SearchX} title={t("invalidTitle")} description={t("invalidText")} />
        ) : (
          <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-verified">
            <div className="flex items-center gap-2">
              <BadgeCheck aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 text-buy" />
              <h2 id="cc-verified" className="title-section">
                {t("validTitle")}
              </h2>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-body">{t("name")}</dt>
                <dd className="font-bold text-ink">{result.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-body">{t("module")}</dt>
                <dd className="font-bold text-ink">{result.moduleTitle}</dd>
              </div>
              <div>
                <dt className="text-body">{t("issued")}</dt>
                <dd className="font-bold text-ink">{formatDate(result.issuedAt, locale)}</dd>
              </div>
              <div>
                <dt className="text-body">{t("code")}</dt>
                <dd className="font-bold text-ink">
                  <Ltr>{result.code}</Ltr>
                </dd>
              </div>
            </dl>
            <p className="text-xs text-mutedtext">{t("disclaimer")}</p>
          </section>
        )}
      </div>
    </div>
  );
}
