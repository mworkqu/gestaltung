import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, Button, EmptyState, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate, formatQAR } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { loadMyPayments } from "@/lib/cad-champions/payments/server";
import { statusTone } from "@/lib/cad-champions/payments/status";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// The student's payments (Prompt 10 Step D): status, amount, code, link to
// the status page (and from there the receipt when paid).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.payments.meta" });
  return ccPageMetadata({ locale, path: "/account/payments", title: t("payments") });
}

export default async function CcPaymentsListPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, "/account/payments"));
  const t = await getTranslations({ locale, namespace: "CC.payments.list" });
  const tStatus = await getTranslations({ locale, namespace: "CC.payments.status" });
  const tp = await getTranslations({ locale, namespace: "CC.payments" });
  const loaded = await loadMyPayments(cc.user.id);

  return (
    <div className="container page-stack">
      <PageHeader title={t("title")} purpose={t("purpose")} />
      {!loaded.ok ? (
        <Alert tone={loaded.reason === "not_set_up" ? "info" : "error"} title={tp(loaded.reason === "not_set_up" ? "notSetUp.title" : "loadError.title")}>
          {tp(loaded.reason === "not_set_up" ? "notSetUp.body" : "loadError.body")}
        </Alert>
      ) : loaded.value.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t("empty.title")}
          description={t("empty.body")}
          action={
            <Button asChild>
              <Link href={ccPath(locale, "/training/join")}>{t("empty.cta")}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {loaded.value.map((p) => (
            <li key={p.id} className="neu flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-bold text-ink">{p.plan ? pick(locale, p.plan.name_en, p.plan.name_ar) : "-"}</p>
                <p className="text-sm text-body">
                  <Ltr className="font-semibold text-ink">{formatQAR(p.amount_qar, locale)}</Ltr>
                  {" · "}
                  <Ltr className="font-mono">{p.reference_code}</Ltr>
                  {" · "}
                  {formatDate(p.created_at, locale)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusChip tone={statusTone(p.status)}>{tStatus(p.status)}</StatusChip>
                <Button asChild variant="secondary" size="sm">
                  <Link href={ccPath(locale, `/account/payments/${p.id}`)} aria-label={`${t("open")} ${p.reference_code}`}>
                    {t("open")}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
