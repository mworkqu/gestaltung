import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, MessageCircle, SearchX } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, Button, EmptyState, PageHeader, StatusChip, Stepper, type StepperStep } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate, formatDateTime, formatQAR } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { bankLabelKey } from "@/lib/cad-champions/payments/banks";
import { loadPayment } from "@/lib/cad-champions/payments/server";
import { PAYMENT_STEP_IDS, paymentSteps, statusTone } from "@/lib/cad-champions/payments/status";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";
import { pick } from "@/lib/cad-champions/training/server";

// Payment status page (Prompt 10 Step D): a Stepper and the explanation for
// each status, with the next action (pay, upload a new proof, open training,
// download the receipt, start again).

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.payments.meta" });
  return ccPageMetadata({ locale, path: `/account/payments/${id}`, title: t("payment") });
}

export default async function CcPaymentStatusPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, `/account/payments/${id}`));
  const t = await getTranslations({ locale, namespace: "CC.payments.statusPage" });
  const tStatus = await getTranslations({ locale, namespace: "CC.payments.status" });
  const tSteps = await getTranslations({ locale, namespace: "CC.payments.steps" });
  const tMethod = await getTranslations({ locale, namespace: "CC.payments.method" });
  const tp = await getTranslations({ locale, namespace: "CC.payments" });
  const tBanks = await getTranslations({ locale, namespace: "CC.payments.banks" });

  const back = (
    <Link href={ccPath(locale, "/account/payments")} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
      <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
      {t("back")}
    </Link>
  );

  const loaded = await loadPayment(cc.user.id, id);
  if (!loaded.ok || !loaded.value) {
    return (
      <div className="container page-stack">
        {back}
        {!loaded.ok ? (
          <Alert tone={loaded.reason === "not_set_up" ? "info" : "error"} title={tp(loaded.reason === "not_set_up" ? "notSetUp.title" : "loadError.title")}>
            {tp(loaded.reason === "not_set_up" ? "notSetUp.body" : "loadError.body")}
          </Alert>
        ) : (
          <EmptyState
            icon={SearchX}
            title={t("notFound.title")}
            description={t("notFound.body")}
            action={
              <Button asChild>
                <Link href={ccPath(locale, "/account/payments")}>{t("notFound.cta")}</Link>
              </Button>
            }
          />
        )}
        <SignedInExtras pageName={tp("meta.payment")} />
      </div>
    );
  }

  const p = loaded.value;
  const states = paymentSteps(p.status);
  const steps: StepperStep[] = PAYMENT_STEP_IDS.map((s) => ({ id: s, label: tSteps(s), status: states[s] }));
  const payHref = `${ccPath(locale, "/training/join/checkout")}?payment=${p.id}`;
  const reason = locale === "ar" ? (p.reject_reason_ar ?? p.reject_reason) : (p.reject_reason ?? p.reject_reason_ar);
  const { whatsappNumber, supportEmail } = getCcContact();
  const wa = buildWhatsAppUrl(whatsappNumber, t("whatsappText", { code: p.reference_code }));

  const bankText = (v: string | null) => {
    const b = bankLabelKey(v);
    return b.key ? tBanks(b.key) : (b.other ?? "-");
  };

  let explain: ReactNode = null;
  switch (p.status) {
    case "awaiting_transfer":
      explain = (
        <Alert
          tone="warning"
          title={t("awaiting", { date: p.expires_at ? formatDateTime(p.expires_at, locale) : "-" })}
          action={
            p.method === "fawran" ? (
              <Button asChild size="sm">
                <Link href={payHref}>{t("payNow")}</Link>
              </Button>
            ) : undefined
          }
        >
          {p.cohort ? t("awaitingSeat") : null}
        </Alert>
      );
      break;
    case "proof_submitted":
      explain = <Alert tone="info" title={t("proof")} />;
      break;
    case "paid":
      explain = (
        <Alert tone="success" title={t("paid")}>
          {p.enrollment ? t("paidUntil", { date: formatDate(p.enrollment.ends_at, locale) }) : null}
          <span className="mt-3 flex flex-wrap gap-3">
            <Button asChild size="sm">
              <Link href={ccPath(locale, "/training")}>{t("openTraining")}</Link>
            </Button>
            {p.receipt_number ? (
              <Button asChild size="sm" variant="secondary">
                <a href={`/api/cad-champions/payments/${p.id}/receipt`} target="_blank" rel="noopener">
                  <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                  {t("receipt")}
                </a>
              </Button>
            ) : null}
          </span>
          {p.receipt_number ? <span className="mt-2 block text-xs">{t("receiptHelp")}</span> : null}
        </Alert>
      );
      break;
    case "rejected":
      explain = (
        <Alert tone="warning" title={t("rejected")}>
          {reason ? t("rejectedReason", { reason }) : null}
          <span className="mt-3 flex flex-wrap gap-3">
            <Button asChild size="sm">
              <Link href={payHref}>{t("uploadNew")}</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a href={wa ?? `mailto:${supportEmail}`} target={wa ? "_blank" : undefined} rel={wa ? "noopener noreferrer" : undefined}>
                <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                {t("whatsapp")}
              </a>
            </Button>
          </span>
        </Alert>
      );
      break;
    case "expired":
      explain = (
        <Alert
          tone="info"
          title={t("expired")}
          action={
            <Button asChild size="sm">
              <Link href={ccPath(locale, "/training/join")}>{t("startAgain")}</Link>
            </Button>
          }
        />
      );
      break;
    case "cancelled":
      explain = (
        <Alert
          tone="info"
          title={t("cancelled")}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={ccPath(locale, "/training/join")}>{t("startAgain")}</Link>
            </Button>
          }
        />
      );
      break;
    case "refunded":
      explain = <Alert tone="info" title={t("refunded")} />;
      break;
  }

  const details: [string, ReactNode][] = [
    [t("plan"), p.plan ? pick(locale, p.plan.name_en, p.plan.name_ar) : "-"],
    ...(p.cohort ? ([[t("cohort"), pick(locale, p.cohort.name_en, p.cohort.name_ar)]] as [string, ReactNode][]) : []),
    [t("amount"), <Ltr key="a" className="font-semibold">{formatQAR(p.amount_qar, locale)}</Ltr>],
    [t("method"), tMethod(p.method)],
    [t("reference"), <Ltr key="r" className="font-mono font-semibold">{p.reference_code}</Ltr>],
    [t("created"), formatDateTime(p.created_at, locale)],
  ];
  const transfer: [string, ReactNode][] = p.proof_submitted_at
    ? [
        [t("payerName"), p.payer_name ?? "-"],
        [t("payerBank"), bankText(p.payer_bank)],
        [t("transferRef"), p.transfer_reference ? <Ltr key="tr" className="font-mono">{p.transfer_reference}</Ltr> : "-"],
        [t("transferredAt"), p.transferred_at ? formatDateTime(p.transferred_at, locale) : "-"],
      ]
    : [];

  return (
    <div className="container page-stack">
      {back}
      <PageHeader title={t("title", { code: p.reference_code })} purpose={t("purpose")} actions={<StatusChip tone={statusTone(p.status)}>{tStatus(p.status)}</StatusChip>} />
      <Stepper steps={steps} />
      {explain}
      <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="cc-pay-details">
        <h2 id="cc-pay-details" className="title-card">
          {t("details")}
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {details.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-semibold text-mutedtext">{k}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {transfer.length ? (
          <>
            <h3 className="title-card pt-2">{t("transfer")}</h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {transfer.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-semibold text-mutedtext">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </section>
      <SignedInExtras pageName={tp("meta.payment")} />
    </div>
  );
}
