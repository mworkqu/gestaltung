"use client";

// Payment summary on the project's Quote step (reviewer + owner, 2026-09-28).
// Payment-ready without a gateway: AI generations priced per call (QAR 20, the credit price),
// parts to buy now, the total, and what's due — 0 while it's free during
// launch. The two ways to pay the reviewer asked for are shown: card
// (including international cards, coming soon) or in person at our office
// after a free chat.

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building2, CreditCard } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/parts/format";
import { paymentSummary } from "@/lib/store/payment";
import { PAYMENT_METHODS } from "@/lib/company";
import { METHOD_ICON } from "@/components/payment/payment-instructions";
import { Skeleton } from "@/components/ui/skeleton";

type Charges = { calls: number; per_call_qar: number; charging: boolean };

/** `partsQar` is null until the store prices have arrived: a skeleton, never a fake QAR 0.00 (audit #59). */
export function PaymentCard({ projectId, partsQar }: { projectId: string; partsQar: number | null }) {
  const t = useTranslations("Payment");
  const tPay = useTranslations("PayMethods");
  const locale = useLocale();
  const [charges, setCharges] = useState<Charges | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc("project_ai_charges", { p_project: projectId })
      .then(({ data, error }) => {
        // Before migration 0038 the function is missing: show nothing rather than a wrong number.
        if (!cancelled && !error && data) setCharges(data as Charges);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!charges) return null;
  const s = paymentSummary({ aiCalls: charges.calls, perCallQar: charges.per_call_qar, partsQar: partsQar ?? 0, charging: charges.charging });
  const money = (n: number) => formatPrice(n, locale);

  return (
    <div className="space-y-3 rounded-xl bg-panel/60 p-4 shadow-neu-inset">
      <p className="text-sm font-bold text-heading">{t("title")}</p>
      <dl className="space-y-1.5 text-sm">
        {charges.charging && (
          <div className="flex justify-between gap-3">
            <dt className="text-mutedtext">{t("aiLine", { count: charges.calls, price: money(charges.per_call_qar) })}</dt>
            <dd className="tabular-nums text-heading">{money(s.lines[0].amountQar)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-mutedtext">{t("partsLine")}</dt>
          <dd className="tabular-nums text-heading">
            {partsQar === null ? <Skeleton className="h-4 w-16" /> : money(s.lines[1].amountQar)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-borderstrong/40 pt-1.5">
          <dt className="font-semibold text-heading">{t("total")}</dt>
          <dd className="font-bold tabular-nums text-heading">
            {partsQar === null ? <Skeleton className="h-4 w-20" /> : money(charges.charging ? s.totalQar : s.lines[1].amountQar)}
          </dd>
        </div>
        {!charges.charging && (
          <div className="flex justify-between gap-3 text-emerald-700">
            <dt className="font-semibold">{t("freeDuringLaunch")}</dt>
          </div>
        )}
      </dl>
      <p className="text-[11px] text-mutedtext">{t("partsNote")}</p>

      <div className="space-y-1.5 text-[12.5px]">
        <p className="font-semibold text-heading">{t("waysToPay")}</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {PAYMENT_METHODS.map((m) => {
            const Icon = METHOD_ICON[m];
            return (
              <li key={m} className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
                <Icon className="h-4 w-4 shrink-0 text-cobalt" />
                <span className="text-heading">{tPay(`${m}_title`)}</span>
              </li>
            );
          })}
          <li className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
            <Building2 className="h-4 w-4 shrink-0 text-cobalt" />
            <span className="text-heading">{t("inPersonTitle")}</span>
            <Link href="/contact" className="ms-auto font-semibold text-cobalt hover:underline">
              {t("bookChat")}
            </Link>
          </li>
          <li className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-mutedtext">
            <CreditCard className="h-4 w-4 shrink-0" />
            {t("cardTitle")}
          </li>
        </ul>
      </div>
    </div>
  );
}
