"use client";

// How to pay for one method (cash on delivery, Fawran, bank transfer).
// Owner, 2026-09-29: payment details stay off the home page (`brief` shows
// only the method), the Fawran alias shows at checkout and on the
// confirmation, and the IBAN is never on the site — it goes out only in the
// order confirmation email.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Banknote, Check, Copy, Landmark, Smartphone } from "lucide-react";

import { COMPANY, COMPANY_WHATSAPP, PAYMENT_DETAILS, type PaymentMethod } from "@/lib/company";
import { cn } from "@/lib/utils";

export const METHOD_ICON = { cash_on_delivery: Banknote, fawran: Smartphone, bank_transfer: Landmark } as const;

function CopyValue({ value, label }: { value: string; label: string }) {
  const t = useTranslations("PayMethods");
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="whitespace-nowrap font-mono font-semibold text-heading" dir="ltr">
        {value}
      </span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value.replace(/\s+/g, " ")).then(
            () => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            },
            () => {}
          );
        }}
        aria-label={t("copy", { what: label })}
        className="rounded p-0.5 text-mutedtext hover:text-cobalt"
      >
        {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

export function PaymentInstructions({
  method,
  amount,
  orderRef,
  className,
  brief,
}: {
  method: PaymentMethod;
  /** Formatted amount to pay, when known. */
  amount?: string;
  /** Short order reference to put in the transfer note. */
  orderRef?: string;
  className?: string;
  /** Method name and one line only — no account details (home page). */
  brief?: boolean;
}) {
  const t = useTranslations("PayMethods");
  const Icon = METHOD_ICON[method];
  return (
    <div className={cn("space-y-2 rounded-xl bg-panel p-4 text-sm shadow-neu-inset", className)}>
      <p className="flex items-center gap-2 font-semibold text-heading">
        <Icon className="h-4 w-4 text-cobalt" />
        {t(`${method}_title`)}
      </p>
      <p className="text-body">{t(`${method}_how`, { amount: amount ?? "" })}</p>
      {!brief && method !== "cash_on_delivery" && (
        <dl className="grid gap-x-6 gap-y-1.5 text-[13px] [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))] [&>div>dt]:text-[11px] [&>div>dt]:text-mutedtext">
          {method === "fawran" && (
            <>
              <div>
                <dt>{t("fawranAlias")}</dt>
                <dd>
                  <CopyValue value={PAYMENT_DETAILS.fawranAlias} label={t("fawranAlias")} />
                </dd>
              </div>
            </>
          )}
          {method === "fawran" && (
            <div>
              <dt>{t("accountName")}</dt>
              <dd className="font-semibold text-heading" dir="ltr">
                {PAYMENT_DETAILS.accountName}{" "}
                <span className="font-normal text-body">({COMPANY.legalNameEn})</span>
              </dd>
            </div>
          )}
          {amount && (
            <>
              <div>
                <dt>{t("amount")}</dt>
                <dd className="font-semibold tabular-nums text-heading">{amount}</dd>
              </div>
            </>
          )}
          {orderRef && (
            <>
              <div>
                <dt>{t("reference")}</dt>
                <dd>
                  <CopyValue value={orderRef} label={t("reference")} />
                </dd>
              </div>
            </>
          )}
        </dl>
      )}
      {!brief && method !== "cash_on_delivery" && (
        <p className="text-[11px] text-mutedtext">
          {t("confirmNote")}{" "}
          <a
            href={COMPANY_WHATSAPP.url}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="inline-block font-semibold text-cobalt hover:underline"
          >
            {COMPANY_WHATSAPP.display}
          </a>
        </p>
      )}
    </div>
  );
}
