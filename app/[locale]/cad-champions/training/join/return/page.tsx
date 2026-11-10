import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ReturnPoller } from "@/components/cad-champions/payments/return-poller";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, Button, PageHeader } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { isUuid } from "@/lib/cad-champions/payments/server";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// SkipCash return page (Prompt 10 Step E): "Confirming your payment..."
// while polling GET /api/cad-champions/payments/<id>/status, then the status page.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ payment?: string }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.payments.meta" });
  return ccPageMetadata({ locale, path: "/training/join/return", title: t("return") });
}

export default async function CcPaymentReturnPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const { payment } = await searchParams;
  await requireCcUser(locale, `${ccPath(locale, "/training/join/return")}${payment ? `?payment=${encodeURIComponent(payment)}` : ""}`);
  const t = await getTranslations({ locale, namespace: "CC.payments.return" });

  return (
    <div className="container page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} />
      {isUuid(payment) ? (
        <ReturnPoller paymentId={payment} />
      ) : (
        <Alert
          tone="error"
          title={t("missing")}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={ccPath(locale, "/account/payments")}>{t("openStatus")}</Link>
            </Button>
          }
        />
      )}
      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
