"use client";

// The Fawran Pay step (Prompt 10 Step D): the amount (large), our details
// with copy buttons, the reference code and its note, 8 numbered steps,
// HelpTip + Help link, then the "I've made the transfer" form. SIGNED-IN ONLY:
// this is the one page that shows the IBAN (site rule: never on public pages).

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, ConfirmDialog, HelpTip, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { cancelReservationAction } from "@/lib/cad-champions/payments/actions";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";

import { CopyField } from "./copy-field";
import { ProofForm } from "./proof-form";

export interface FawranPayProps {
  paymentId: string;
  userId: string;
  status: "awaiting_transfer" | "rejected";
  amount: string;
  referenceCode: string;
  expiresAt: string | null;
  rejectReason: string | null;
  details: { alias: string; mobile: string | null; iban: string; accountName: string; bankName: string };
}

const STEPS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

export function FawranPay(props: FawranPayProps) {
  const t = useTranslations("CC.payments.pay");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = React.useState(false);

  async function cancel() {
    const res = await cancelReservationAction({ paymentId: props.paymentId });
    setCancelOpen(false);
    if (res.ok) {
      toast.info(t("cancelled"), t("cancelledBody"));
      router.push(ccPath(locale, "/training/join"));
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {props.status === "rejected" ? (
        <Alert tone="warning" title={t("rejectedTitle")}>
          {props.rejectReason ? t("rejectedReason", { reason: props.rejectReason }) : null}
        </Alert>
      ) : null}

      <section className="neu space-y-5 p-6 sm:p-8" aria-labelledby="cc-pay-title">
        <div className="flex items-center gap-2">
          <h2 id="cc-pay-title" className="title-section">
            {t("title")}
          </h2>
          <HelpTip label={t("helpLabel")} learnMoreSlug="how-to-pay-with-fawran">
            {t("help")}
          </HelpTip>
        </div>

        <div className="neu-inset p-5 text-center">
          <p className="text-sm font-semibold text-body">{t("amountLabel")}</p>
          <Ltr as="p" className="mt-1 text-4xl font-extrabold text-heading sm:text-5xl">
            {props.amount}
          </Ltr>
          <p className="mt-1 text-sm text-body">{t("exact")}</p>
        </div>

        <div className="space-y-2">
          <h3 className="title-card">{t("codeTitle")}</h3>
          <CopyField label={t("codeTitle")} value={props.referenceCode} large />
          <p className="text-sm font-semibold text-ink">{t("codeNote")}</p>
          {props.expiresAt && props.status === "awaiting_transfer" ? <p className="text-sm text-body">{t("expires", { date: props.expiresAt })}</p> : null}
        </div>

        <div className="space-y-2">
          <h3 className="title-card">{t("detailsTitle")}</h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <CopyField label={t("alias")} value={props.details.alias} />
            {props.details.mobile ? <CopyField label={t("mobile")} value={props.details.mobile} /> : null}
            <CopyField label={t("iban")} value={props.details.iban} />
            <CopyField label={t("accountName")} value={props.details.accountName} />
            <CopyField label={t("bank")} value={props.details.bankName} />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="title-card">{t("stepsTitle")}</h3>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {STEPS.map((n) => (
              <li key={n} className="tile flex items-start gap-3 !p-3">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                  {n}
                </span>
                <span className="text-sm text-ink">{t(`steps.${n}`)}</span>
              </li>
            ))}
          </ol>
          <Link href={ccPath(locale, "/help/how-to-pay-with-fawran")} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline">
            {t("helpLink")}
          </Link>
        </div>
      </section>

      <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-proof-title">
        <div>
          <h2 id="cc-proof-title" className="title-section">
            {t("doneTitle")}
          </h2>
          <p className="mt-1 text-sm text-body">{t("doneText")}</p>
        </div>
        <ProofForm paymentId={props.paymentId} userId={props.userId} />
      </section>

      {props.status === "awaiting_transfer" ? (
        <div>
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>
            {t("cancel")}
          </Button>
          <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title={t("cancelTitle")} consequence={t("cancelBody")} confirmLabel={t("cancelConfirm")} tone="danger" onConfirm={cancel} />
        </div>
      ) : null}
    </div>
  );
}
