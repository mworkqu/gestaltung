import { getTranslations } from "next-intl/server";
import { BadgeCheck, MapPin } from "lucide-react";

import { COMPANY } from "@/lib/company";
import { PaymentInstructions } from "@/components/payment/payment-instructions";

// Home page: who you're buying from and how you can pay (owner, 2026-09-29).
// The registered company (C.R. 236988) beside the three ways to pay — method
// names only; the details appear at checkout and in the confirmation email.
export async function HomeTrust() {
  const t = await getTranslations("PayMethods");
  const tc = await getTranslations("Company");
  return (
    <section className="animate-fade-up delay-3 grid gap-6 lg:grid-cols-12">
      <div className="neu flex flex-col justify-between gap-4 p-6 lg:col-span-4">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-azure">{t("homeKicker")}</p>
          <h2 className="text-2xl font-extrabold tracking-tight text-heading">{tc("legalName")}</h2>
          <p className="text-sm text-body">{t("homeIntro")}</p>
        </div>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-emerald-600" aria-hidden />
            <dt className="text-mutedtext">{t("crLabel")}</dt>
            <dd className="font-mono font-semibold text-heading" dir="ltr">
              {COMPANY.crNumber}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-cobalt" aria-hidden />
            <dt className="sr-only">{t("locationLabel")}</dt>
            <dd className="text-heading">{tc("location")}</dd>
          </div>
        </dl>
      </div>
      <div className="neu space-y-3 p-6 lg:col-span-8">
        <h2 className="text-lg font-bold text-heading">{t("homeTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <PaymentInstructions method="cash_on_delivery" brief />
          <PaymentInstructions method="fawran" brief />
          <PaymentInstructions method="bank_transfer" brief className="sm:col-span-2" />
        </div>
        <p className="text-[11px] text-mutedtext">{t("methodsLine")}</p>
      </div>
    </section>
  );
}
