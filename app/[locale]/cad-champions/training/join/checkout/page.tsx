import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, SearchX } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CheckoutClient, type CheckoutCohort, type CheckoutPlan } from "@/components/cad-champions/payments/checkout-client";
import { FawranPay } from "@/components/cad-champions/payments/fawran-pay";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { Alert, Button, EmptyState, PageHeader, Stepper } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate, formatDateTime, formatQAR } from "@/lib/cad-champions/format";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { canRenew, isPurchasable, needsCohort, seatsLeft } from "@/lib/cad-champions/payments/plans";
import { loadActiveEnrollment, loadCatalog, loadPayment, payDetails, priceGate, skipCashAvailable } from "@/lib/cad-champions/payments/server";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { pick } from "@/lib/cad-champions/training/server";

// Checkout (Prompt 10 Step B + D). Without ?payment: choose plan -> cohort ->
// order summary (coupon, add-on, Terms) -> "Reserve". With ?payment=<id> (the
// student's own): the Pay step for Fawran (signed-in only: the one page with
// the IBAN), then the Confirmation once the proof is sent.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ plan?: string; payment?: string }> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.payments.meta" });
  return ccPageMetadata({ locale, path: "/training/join/checkout", title: t("checkout") });
}

export default async function CcCheckoutPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const sp = await searchParams;
  const here = `${ccPath(locale, "/training/join/checkout")}${sp.payment ? `?payment=${encodeURIComponent(sp.payment)}` : sp.plan ? `?plan=${encodeURIComponent(sp.plan)}` : ""}`;
  const cc = await requireCcUser(locale, here);
  const t = await getTranslations({ locale, namespace: "CC.payments.checkout" });
  const tj = await getTranslations({ locale, namespace: "CC.payments.join" });
  const tp = await getTranslations({ locale, namespace: "CC.payments" });
  const tsp = await getTranslations({ locale, namespace: "CC.payments.statusPage" });

  const header = <PageHeader title={t("title")} purpose={t("purpose")} />;

  // ── Pay / Confirmation for an existing payment ──
  if (sp.payment) {
    const loaded = await loadPayment(cc.user.id, sp.payment);
    if (!loaded.ok) {
      return (
        <div className="container page-stack">
          {header}
          <Alert tone="info" title={tp(loaded.reason === "not_set_up" ? "notSetUp.title" : "loadError.title")}>
            {tp(loaded.reason === "not_set_up" ? "notSetUp.body" : "loadError.body")}
          </Alert>
          <SignedInExtras pageName={t("title")} />
        </div>
      );
    }
    const p = loaded.value;
    if (!p) {
      return (
        <div className="container page-stack">
          {header}
          <EmptyState
            icon={SearchX}
            title={tsp("notFound.title")}
            description={tsp("notFound.body")}
            action={
              <Button asChild>
                <Link href={ccPath(locale, "/account/payments")}>{tsp("notFound.cta")}</Link>
              </Button>
            }
          />
          <SignedInExtras pageName={t("title")} />
        </div>
      );
    }
    const isPay = p.method === "fawran" && (p.status === "awaiting_transfer" || p.status === "rejected");
    const isConfirm = p.status === "proof_submitted";
    if (!isPay && !isConfirm) redirect(ccPath(locale, `/account/payments/${p.id}`));

    const planName = p.plan ? pick(locale, p.plan.name_en, p.plan.name_ar) : "";
    const cohortName = p.cohort ? pick(locale, p.cohort.name_en, p.cohort.name_ar) : null;
    const steps = [
      { id: "plan", label: t("steps.plan"), status: "done" as const, description: planName },
      { id: "cohort", label: t("steps.cohort"), status: "done" as const, description: cohortName ?? t("cohortNotNeeded") },
      { id: "pay", label: t("steps.pay"), status: isPay ? ("current" as const) : ("done" as const) },
      { id: "confirm", label: t("steps.confirm"), status: isConfirm ? ("current" as const) : ("upcoming" as const) },
    ];
    const reason = locale === "ar" ? (p.reject_reason_ar ?? p.reject_reason) : (p.reject_reason ?? p.reject_reason_ar);

    return (
      <div className="container page-stack">
        {header}
        <Stepper steps={steps} />
        {isPay ? (
          <FawranPay
            paymentId={p.id}
            userId={cc.user.id}
            status={p.status as "awaiting_transfer" | "rejected"}
            amount={formatQAR(p.amount_qar, locale)}
            referenceCode={p.reference_code}
            expiresAt={p.expires_at ? formatDateTime(p.expires_at, locale) : null}
            rejectReason={reason}
            details={payDetails()}
          />
        ) : (
          <section className="neu flex flex-col items-start gap-4 p-6 sm:p-8" aria-labelledby="cc-co-confirm">
            <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-8 w-8 text-buy" />
            <h2 id="cc-co-confirm" className="title-section">
              {t("confirmTitle")}
            </h2>
            <p className="text-base text-body">{t("confirmBody")}</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href={ccPath(locale, `/account/payments/${p.id}`)}>{t("seeStatus")}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={ccPath(locale, "/dashboard")}>{t("backToDashboard")}</Link>
              </Button>
            </div>
          </section>
        )}
        <SignedInExtras pageName={t("title")} />
      </div>
    );
  }

  // ── Choose plan / cohort / summary ──
  const [catalog, showPrices, enrollment] = await Promise.all([loadCatalog(), priceGate(cc), loadActiveEnrollment(cc.user.id)]);

  let body: ReactNode;
  if (!catalog.ok) {
    body = (
      <Alert tone={catalog.reason === "not_set_up" ? "info" : "error"} title={tp(catalog.reason === "not_set_up" ? "notSetUp.title" : "loadError.title")}>
        {tp(catalog.reason === "not_set_up" ? "notSetUp.body" : "loadError.body")}
      </Alert>
    );
  } else if (!showPrices) {
    body = (
      <Alert
        tone="info"
        title={tj("pricesAfterTest")}
        action={
          <Button asChild size="sm">
            <Link href={ccPath(locale, "/test")}>{tj("takeTest")}</Link>
          </Button>
        }
      >
        {tj("pricesAfterTestText")}
      </Alert>
    );
  } else if (enrollment && !canRenew(enrollment.ends_at)) {
    body = (
      <Alert
        tone="success"
        title={tj("active.title")}
        action={
          <Button asChild size="sm">
            <Link href={ccPath(locale, "/training")}>{tj("active.open")}</Link>
          </Button>
        }
      >
        {tj("active.body", { date: formatDate(enrollment.ends_at, locale) })} {tj("active.renewNote")}
      </Alert>
    );
  } else {
    const plans: CheckoutPlan[] = catalog.plans.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: pick(locale, p.name_en, p.name_ar),
      whoFor: p.who_for_en || p.who_for_ar ? pick(locale, p.who_for_en, p.who_for_ar) : null,
      includes: locale === "ar" && p.includes_ar.length ? p.includes_ar : p.includes_en,
      priceQar: p.price_qar,
      durationDays: p.duration_days,
      needsCohort: needsCohort(p),
      featured: p.is_featured,
      purchasable: isPurchasable(p),
    }));
    const cohorts: CheckoutCohort[] = catalog.cohorts.map((c) => ({
      id: c.id,
      name: pick(locale, c.name_en, c.name_ar),
      dates: c.starts_on ? `${formatDate(c.starts_on, locale)}${c.ends_on ? ` – ${formatDate(c.ends_on, locale)}` : ""}` : null,
      location: c.location_en || c.location_ar ? pick(locale, c.location_en, c.location_ar) : null,
      seatsLeft: seatsLeft(c, c.taken),
      availability: c.availability,
    }));
    const addon =
      catalog.addon && catalog.addon.price_qar != null && catalog.addon.price_qar > 0
        ? { name: pick(locale, catalog.addon.name_en, catalog.addon.name_ar), priceQar: catalog.addon.price_qar }
        : null;
    body = <CheckoutClient plans={plans} cohorts={cohorts} addon={addon} initialPlanSlug={sp.plan ?? null} skipcashEnabled={skipCashAvailable()} />;
  }

  return (
    <div className="container page-stack">
      {header}
      {body}
      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
