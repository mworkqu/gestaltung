import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminPaymentCard, type AdminPaymentCardData } from "@/components/cad-champions/payments/admin-payment-card";
import { Alert, EmptyState, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatDateTime, formatQAR } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { bankLabelKey } from "@/lib/cad-champions/payments/banks";
import { ADMIN_STATUS_FILTERS, loadAdminPayments, type AdminStatusFilter } from "@/lib/cad-champions/payments/server";
import { statusTone } from "@/lib/cad-champions/payments/status";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// Admin payments queue (Prompt 10 Step D). Admin only (requireCcAdmin; the
// actions re-check the role). proof_submitted first, oldest proof first.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.payments.meta" });
  return ccPageMetadata({ locale, path: "/admin/payments", title: t("admin") });
}

export default async function CcAdminPaymentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/payments"));
  const t = await getTranslations({ locale, namespace: "CC.payments.admin" });
  const tStatus = await getTranslations({ locale, namespace: "CC.payments.status" });
  const tBanks = await getTranslations({ locale, namespace: "CC.payments.banks" });
  const sp = await searchParams;
  const filter: AdminStatusFilter = (ADMIN_STATUS_FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as AdminStatusFilter) : "queue";
  const loaded = await loadAdminPayments(filter);

  const selectCls = "min-h-11 rounded-xl border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  const cards: AdminPaymentCardData[] = loaded.ok
    ? loaded.value.map((p) => {
        const b = bankLabelKey(p.payer_bank);
        return {
          id: p.id,
          status: p.status,
          statusLabel: tStatus(p.status),
          tone: statusTone(p.status),
          studentName: p.student.name ?? p.payer_name ?? "-",
          studentEmail: p.student.email,
          studentPhone: p.student.phone,
          plan: p.plan ? pick(locale, p.plan.name_en, p.plan.name_ar) : "-",
          cohort: p.cohort ? pick(locale, p.cohort.name_en, p.cohort.name_ar) : null,
          amount: formatQAR(p.amount_qar, locale),
          referenceCode: p.reference_code,
          payerName: p.payer_name,
          payerBank: b.key ? tBanks(b.key) : b.other,
          transferReference: p.transfer_reference,
          transferredAt: p.transferred_at ? formatDateTime(p.transferred_at, locale) : null,
          created: formatDateTime(p.created_at, locale),
          expires: p.expires_at ? formatDateTime(p.expires_at, locale) : null,
          rejectReason: p.status === "rejected" ? (locale === "ar" ? (p.reject_reason_ar ?? p.reject_reason) : p.reject_reason) : null,
          proofUrl: p.proofUrl,
          proofIsPdf: p.proofIsPdf,
        };
      })
    : [];

  return (
    <div className="container page-stack">
      <Link href={ccPath(locale, "/admin")} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("helpLabel")}>{t("help")}</HelpTip>} />

      <form method="get" className="neu flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          {t("filter")}
          <select name="status" defaultValue={filter} className={selectCls}>
            {ADMIN_STATUS_FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`filters.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
          {t("apply")}
        </button>
      </form>

      {!loaded.ok ? (
        <Alert tone={loaded.reason === "not_set_up" ? "info" : "error"} title={t(loaded.reason === "not_set_up" ? "errors.not_set_up" : "errors.error")} />
      ) : cards.length === 0 ? (
        <EmptyState icon={Inbox} title={t("empty.title")} description={t("empty.body")} />
      ) : (
        <div className="space-y-4">
          {cards.map((c) => (
            <AdminPaymentCard key={c.id} p={c} />
          ))}
        </div>
      )}
    </div>
  );
}
