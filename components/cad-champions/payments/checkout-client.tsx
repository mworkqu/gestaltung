"use client";

// Checkout (Prompt 10 Step B): Stepper Choose plan -> Cohort (in-person
// plans only; full cohorts disabled with "Full") -> Pay -> Confirmation.
// This component covers the first steps up to "Reserve and continue"; the
// server creates the payment (amounts computed there, never here) and the
// page then shows the Pay step for that payment.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, EmptyState, HelpTip, Stepper, useToast, type StepperStep } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { createCheckoutAction, validateCouponAction } from "@/lib/cad-champions/payments/actions";
import { computeTotals } from "@/lib/cad-champions/payments/coupon";
import { formatQAR } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";

export interface CheckoutPlan {
  id: string;
  slug: string;
  name: string;
  whoFor: string | null;
  includes: string[];
  priceQar: number | null;
  durationDays: number | null;
  needsCohort: boolean;
  featured: boolean;
  purchasable: boolean;
}

export interface CheckoutCohort {
  id: string;
  name: string;
  dates: string | null;
  location: string | null;
  seatsLeft: number;
  availability: "open" | "full" | "closed";
}

type Step = "plan" | "cohort" | "pay";

type CouponState = { status: "idle" } | { status: "checking" } | { status: "applied"; code: string; discount: number } | { status: "error"; reason: string };

export function CheckoutClient({
  plans,
  cohorts,
  addon,
  initialPlanSlug,
  skipcashEnabled,
}: {
  plans: CheckoutPlan[];
  cohorts: CheckoutCohort[];
  addon: { name: string; priceQar: number } | null;
  initialPlanSlug: string | null;
  skipcashEnabled: boolean;
}) {
  const t = useTranslations("CC.payments.checkout");
  const tc = useTranslations("CC.payments.coupon");
  const tj = useTranslations("CC.payments.join");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();

  const firstBuyable = plans.find((p) => p.slug === initialPlanSlug && p.purchasable) ?? null;
  const [planSlug, setPlanSlug] = React.useState<string | null>(firstBuyable?.slug ?? null);
  const [step, setStep] = React.useState<Step>(firstBuyable ? (firstBuyable.needsCohort ? "cohort" : "pay") : "plan");
  const [cohortId, setCohortId] = React.useState<string | null>(null);
  const [couponInput, setCouponInput] = React.useState("");
  const [coupon, setCoupon] = React.useState<CouponState>({ status: "idle" });
  const [addKit, setAddKit] = React.useState(false);
  const [terms, setTerms] = React.useState(false);
  const [method, setMethod] = React.useState<"fawran" | "skipcash">("fawran");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const couponId = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const plan = plans.find((p) => p.slug === planSlug) ?? null;
  const cohort = cohorts.find((c) => c.id === cohortId) ?? null;

  React.useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // A coupon is checked against a plan: changing the plan clears it.
  React.useEffect(() => {
    setCoupon({ status: "idle" });
  }, [planSlug]);

  const steps: StepperStep[] = [
    { id: "plan", label: t("steps.plan"), status: step === "plan" ? "current" : "done", description: plan?.name },
    {
      id: "cohort",
      label: t("steps.cohort"),
      status: step === "cohort" ? "current" : step === "pay" ? "done" : "upcoming",
      description: plan && !plan.needsCohort ? t("cohortNotNeeded") : (cohort?.name ?? undefined),
    },
    { id: "pay", label: t("steps.pay"), status: step === "pay" ? "current" : "upcoming" },
    { id: "confirm", label: t("steps.confirm"), status: "upcoming" },
  ];

  const totals = plan?.priceQar != null
    ? computeTotals({
        planPrice: plan.priceQar,
        coupon: coupon.status === "applied" ? { type: "fixed", value: coupon.discount } : null,
        addonPrice: addKit && addon ? addon.priceQar : null,
      })
    : null;

  function choosePlan(slug: string) {
    const p = plans.find((x) => x.slug === slug);
    if (!p?.purchasable) return;
    setPlanSlug(slug);
    setError(null);
    if (!p.needsCohort) setCohortId(null);
    setStep(p.needsCohort ? "cohort" : "pay");
  }

  async function applyCoupon() {
    if (!plan || !couponInput.trim()) return;
    setCoupon({ status: "checking" });
    const res = await validateCouponAction({ code: couponInput, planId: plan.id });
    if (res.ok) setCoupon({ status: "applied", code: res.code, discount: res.discountQar });
    else setCoupon({ status: "error", reason: res.reason });
  }

  async function submit() {
    if (!plan) return;
    setError(null);
    if (!terms) {
      setError(t("errors.terms"));
      return;
    }
    if (plan.needsCohort && !cohortId) {
      setError(t("errors.cohort_required"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await createCheckoutAction({
        locale,
        planSlug: plan.slug,
        cohortId: plan.needsCohort ? cohortId : null,
        couponCode: coupon.status === "applied" ? coupon.code : null,
        addKit: addKit && !!addon,
        termsAccepted: terms,
        method,
      });
      if (!res.ok) {
        setError(t(`errors.${res.error}`));
        setSubmitting(false);
        return;
      }
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return;
      }
      toast.success(t("reservedToast"), t("reservedToastBody"));
      router.push(`${ccPath(locale, "/training/join/checkout")}?payment=${res.paymentId}`);
    } catch (e) {
      console.error("[cc-checkout] failed", e instanceof Error ? e.message : e);
      setError(t("errors.error"));
      setSubmitting(false);
    }
  }

  const fmt = (n: number) => formatQAR(n, locale);

  return (
    <div className="space-y-6">
      <Stepper steps={steps} />

      {step === "plan" ? (
        <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-co-plan">
          <h2 id="cc-co-plan" ref={headingRef} tabIndex={-1} className="title-section focus-visible:outline-none">
            {t("planTitle")}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {plans.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => choosePlan(p.slug)}
                disabled={!p.purchasable}
                aria-pressed={p.slug === planSlug}
                className={cn(
                  "tile flex flex-col items-start gap-2 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60",
                  p.slug === planSlug && "ring-2 ring-accent",
                )}
              >
                <span className="text-lg font-extrabold text-heading">{p.name}</span>
                {p.whoFor ? <span className="text-sm text-body">{p.whoFor}</span> : null}
                <span className="text-sm font-bold text-ink">
                  {p.priceQar != null ? <Ltr>{fmt(p.priceQar)}</Ltr> : tj("priceSoon")}
                  {p.durationDays ? ` · ${tj("days", { days: String(p.durationDays) })}` : ""}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === "cohort" && plan ? (
        <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-co-cohort">
          <div className="flex items-center gap-2">
            <h2 id="cc-co-cohort" ref={headingRef} tabIndex={-1} className="title-section focus-visible:outline-none">
              {t("cohortTitle")}
            </h2>
            <HelpTip label={t("cohortHelpLabel")}>{t("cohortHelp")}</HelpTip>
          </div>
          {cohorts.length === 0 ? (
            <EmptyState icon={CalendarDays} title={t("noCohorts.title")} description={t("noCohorts.body")} action={<Button variant="secondary" onClick={() => setStep("plan")}>{t("back")}</Button>} />
          ) : (
            <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <legend className="sr-only">{t("cohortTitle")}</legend>
              {cohorts.map((c) => {
                const disabled = c.availability !== "open";
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "tile flex cursor-pointer items-start gap-3",
                      disabled && "cursor-not-allowed opacity-60",
                      cohortId === c.id && "ring-2 ring-accent",
                    )}
                  >
                    <input type="radio" name="cohort" value={c.id} checked={cohortId === c.id} disabled={disabled} onChange={() => setCohortId(c.id)} className="mt-1 h-5 w-5 accent-[var(--accent,#0e59c5)]" />
                    <span className="min-w-0 space-y-1">
                      <span className="block font-bold text-ink">{c.name}</span>
                      {c.dates ? <span className="block text-sm text-body">{c.dates}</span> : null}
                      {c.location ? <span className="block text-sm text-body">{c.location}</span> : null}
                      <span className={cn("block text-sm font-semibold", disabled ? "text-[#a1231f]" : "text-buy")}>
                        {c.availability === "full" ? t("full") : c.availability === "closed" ? t("closed") : t("seatsLeft", { count: String(c.seatsLeft) })}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setStep("plan")}>
              {t("back")}
            </Button>
            <Button onClick={() => cohortId && setStep("pay")} disabled={!cohortId} disabledReason={t("errors.cohort_required")}>
              {t("next")}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "pay" && plan && totals ? (
        <section className="neu space-y-5 p-6 sm:p-8" aria-labelledby="cc-co-pay">
          <h2 id="cc-co-pay" ref={headingRef} tabIndex={-1} className="title-section focus-visible:outline-none">
            {t("summaryTitle")}
          </h2>

          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-body">{t("plan")}</dt>
              <dd className="font-semibold text-ink">{plan.name}</dd>
            </div>
            {plan.needsCohort && cohort ? (
              <div className="flex justify-between gap-3">
                <dt className="text-body">{t("cohort")}</dt>
                <dd className="font-semibold text-ink">{cohort.name}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-body">{t("price")}</dt>
              <dd>
                <Ltr className="font-semibold text-ink">{fmt(totals.list)}</Ltr>
              </dd>
            </div>
            {coupon.status === "applied" ? (
              <div className="flex justify-between gap-3 text-buy">
                <dt>{t("discount", { code: coupon.code })}</dt>
                <dd>
                  <Ltr className="font-semibold">−{fmt(totals.discount)}</Ltr>
                </dd>
              </div>
            ) : null}
            {addKit && addon ? (
              <div className="flex justify-between gap-3">
                <dt className="text-body">{t("addon")}</dt>
                <dd>
                  <Ltr className="font-semibold text-ink">{fmt(totals.addon)}</Ltr>
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 border-t border-border pt-2 text-base">
              <dt className="font-bold text-ink">{t("total")}</dt>
              <dd>
                <Ltr className="font-extrabold text-heading">{fmt(totals.amount)}</Ltr>
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <label htmlFor={couponId} className="text-sm font-semibold text-ink">
                {tc("label")}
              </label>
              <HelpTip label={tc("helpLabel")}>{tc("help")}</HelpTip>
            </div>
            {coupon.status === "applied" ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="status" className="text-sm font-semibold text-buy">
                  {tc("applied", { code: coupon.code, amount: fmt(coupon.discount) })}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCoupon({ status: "idle" });
                    setCouponInput("");
                  }}
                >
                  {tc("remove")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  id={couponId}
                  dir="ltr"
                  value={couponInput}
                  onChange={(e) => {
                    setCouponInput(e.target.value.toUpperCase());
                    if (coupon.status === "error") setCoupon({ status: "idle" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyCoupon();
                    }
                  }}
                  placeholder={tc("placeholder")}
                  maxLength={40}
                  aria-invalid={coupon.status === "error" || undefined}
                  aria-describedby={coupon.status === "error" ? `${couponId}-err` : undefined}
                  className="min-h-11 w-full max-w-xs rounded-xl border border-border bg-surface px-3 font-mono text-base uppercase text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <Button variant="secondary" onClick={applyCoupon} loading={coupon.status === "checking"} loadingText={tc("checking")} disabled={!couponInput.trim()}>
                  {tc("apply")}
                </Button>
              </div>
            )}
            {coupon.status === "error" ? (
              <p id={`${couponId}-err`} role="alert" className="text-sm font-semibold text-[#a1231f]">
                {tc(`errors.${coupon.reason}`)}
              </p>
            ) : null}
          </div>

          {addon ? (
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={addKit} onChange={(e) => setAddKit(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--accent,#0e59c5)]" />
              <span className="text-sm text-ink">
                {t("addKit", { name: addon.name, price: fmt(addon.priceQar) })}
                <span className="block text-body">{t("addKitHelp")}</span>
              </span>
            </label>
          ) : null}

          {skipcashEnabled ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-ink">{t("methodTitle")}</legend>
              {(["fawran", "skipcash"] as const).map((m) => (
                <label key={m} className={cn("tile flex cursor-pointer items-start gap-3", method === m && "ring-2 ring-accent")}>
                  <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="mt-1 h-5 w-5 accent-[var(--accent,#0e59c5)]" />
                  <span>
                    <span className="block font-bold text-ink">{t(m)}</span>
                    <span className="block text-sm text-body">{t(m === "fawran" ? "fawranHelp" : "skipcashHelp")}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          <label className="flex items-start gap-3">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--accent,#0e59c5)]" />
            <span className="text-sm text-ink">
              {t.rich("terms", {
                terms: (chunks) => (
                  <Link href={ccPath(locale, "/terms")} target="_blank" className="font-semibold text-accent underline">
                    {chunks}
                  </Link>
                ),
                refund: (chunks) => (
                  <Link href={ccPath(locale, "/terms")} target="_blank" className="font-semibold text-accent underline">
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>

          {error ? <Alert tone="error" title={error} /> : null}

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setStep(plan.needsCohort ? "cohort" : "plan")} disabled={submitting}>
              {t("back")}
            </Button>
            <Button onClick={submit} loading={submitting} loadingText={method === "skipcash" ? t("redirecting") : t("submitting")}>
              {method === "skipcash" ? t("submitSkipcash") : t("submit")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
