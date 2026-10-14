import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, GraduationCap, MessageCircle, Package, Receipt } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { BackToTraining } from "@/components/cad-champions/training/page-bits";
import { Alert, Button, EmptyState, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import { requireCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate, formatQAR } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { canRenew, isPurchasable, needsCohort } from "@/lib/cad-champions/payments/plans";
import { loadActiveEnrollment, loadCatalog, loadMyPayments, priceGate } from "@/lib/cad-champions/payments/server";
import { OPEN_STATUSES } from "@/lib/cad-champions/payments/state-machine";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { buildWhatsAppUrl, getCcContact } from "@/lib/cad-champions/site-contact";
import { pick } from "@/lib/cad-champions/training/server";
import { cn } from "@/lib/utils";

// Plans (Prompt 10 Step B): comparison cards (side by side, stacked on
// phones) with a "What's included" checklist and who each plan is for. Prices
// show only after the student has submitted the diagnostic test; before that
// "See prices after your free test". A plan with no price yet shows "Price
// coming soon" and can't be bought. FAQ at the bottom.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.payments.meta" });
  return ccPageMetadata({ locale, path: "/training/join", title: t("join") });
}

export default async function CcTrainingJoinPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcUser(locale, ccPath(locale, "/training/join"));
  const t = await getTranslations({ locale, namespace: "CC.payments.join" });
  const tFaq = await getTranslations({ locale, namespace: "CC.payments.faq" });
  const tStatus = await getTranslations({ locale, namespace: "CC.payments.status" });
  const tPage = await getTranslations({ locale, namespace: "CC.payments" });

  const [catalog, showPrices, enrollment, payments] = await Promise.all([loadCatalog(), priceGate(cc), loadActiveEnrollment(cc.user.id), loadMyPayments(cc.user.id)]);
  const open = payments.ok ? payments.value.find((p) => OPEN_STATUSES.includes(p.status)) : undefined;
  const renewable = enrollment ? canRenew(enrollment.ends_at) : true;
  const { whatsappNumber, supportEmail } = getCcContact();
  const wa = buildWhatsAppUrl(whatsappNumber, t("whatsappText"));

  const faq: [string, string][] = [
    ["q1", "a1"],
    ["q2", "a2"],
    ["q3", "a3"],
    ["q4", "a4"],
  ];

  return (
    <div className="container page-stack">
      <PageHeader
        title={t("title")}
        purpose={t("purpose")}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href={ccPath(locale, "/account/payments")}>
                <Receipt aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                {t("myPayments")}
              </Link>
            </Button>
            <BackToTraining locale={locale} />
          </>
        }
      />

      {enrollment ? (
        <Alert
          tone="success"
          title={t("active.title")}
          action={
            <Button asChild size="sm">
              <Link href={ccPath(locale, "/training")}>{t("active.open")}</Link>
            </Button>
          }
        >
          {t("active.body", { date: formatDate(enrollment.ends_at, locale) })} {renewable ? t("active.renewOpen") : t("active.renewNote")}
        </Alert>
      ) : null}

      {open ? (
        <Alert
          tone="info"
          title={t("pending.title")}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={ccPath(locale, `/account/payments/${open.id}`)}>{t("pending.open")}</Link>
            </Button>
          }
        >
          {tStatus(open.status)} · <Ltr className="font-mono font-semibold">{open.reference_code}</Ltr>
        </Alert>
      ) : null}

      {!catalog.ok ? (
        <Alert tone={catalog.reason === "not_set_up" ? "info" : "error"} title={tPage(catalog.reason === "not_set_up" ? "notSetUp.title" : "loadError.title")}>
          {tPage(catalog.reason === "not_set_up" ? "notSetUp.body" : "loadError.body")}
        </Alert>
      ) : catalog.plans.length === 0 ? (
        <EmptyState icon={GraduationCap} title={t("empty.title")} description={t("empty.body")} />
      ) : (
        <>
          {!showPrices ? (
            <Alert
              tone="info"
              title={t("pricesAfterTest")}
              action={
                <Button asChild size="sm">
                  <Link href={ccPath(locale, "/test")}>{t("takeTest")}</Link>
                </Button>
              }
            >
              {t("pricesAfterTestText")}
            </Alert>
          ) : null}

          <ul className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {catalog.plans.map((p) => {
              const includes = locale === "ar" && p.includes_ar.length ? p.includes_ar : p.includes_en;
              const buyable = isPurchasable(p);
              return (
                <li key={p.id} className={cn("neu flex flex-col gap-4 p-6 sm:p-8", p.is_featured && "ring-2 ring-accent")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="title-section">{pick(locale, p.name_en, p.name_ar)}</h2>
                    {p.is_featured ? <StatusChip tone="info">{t("featured")}</StatusChip> : null}
                  </div>
                  {p.who_for_en || p.who_for_ar ? (
                    <p className="text-sm text-body">
                      <span className="font-semibold text-ink">{t("whoFor")}: </span>
                      {pick(locale, p.who_for_en, p.who_for_ar)}
                    </p>
                  ) : null}

                  <div className="neu-inset p-4">
                    {showPrices ? (
                      p.price_qar != null ? (
                        <p>
                          <Ltr className="text-3xl font-extrabold text-heading">{formatQAR(p.price_qar, locale)}</Ltr>
                          {p.duration_days ? <span className="ms-2 text-sm text-body">{t("days", { days: String(p.duration_days) })}</span> : null}
                        </p>
                      ) : (
                        <div className="flex items-center gap-1">
                          <p className="text-lg font-bold text-ink">{t("priceSoon")}</p>
                          <HelpTip label={t("priceSoon")}>{t("priceSoonHelp")}</HelpTip>
                        </div>
                      )
                    ) : (
                      <p className="text-base font-bold text-ink">{t("pricesAfterTest")}</p>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-bold text-ink">{t("includes")}</p>
                    <ul className="mt-2 space-y-2">
                      {includes.map((x, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-body">
                          <Check aria-hidden="true" strokeWidth={2} className="mt-0.5 h-4 w-4 shrink-0 text-buy" />
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {needsCohort(p) ? (
                    <p className="text-sm text-body">
                      {t("inPersonNote")}{" "}
                      <Link href={ccPath(locale, "/training/in-person")} className="font-semibold text-accent underline-offset-2 hover:underline">
                        {t("seeCohorts")}
                      </Link>
                    </p>
                  ) : null}

                  <div className="mt-auto">
                    {!showPrices ? (
                      <Button asChild variant="secondary">
                        <Link href={ccPath(locale, "/test")}>{t("takeTest")}</Link>
                      </Button>
                    ) : buyable && renewable ? (
                      <Button asChild>
                        <Link href={`${ccPath(locale, "/training/join/checkout")}?plan=${encodeURIComponent(p.slug)}`}>{enrollment ? t("renew") : t("choose")}</Link>
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {catalog.addon ? (
            <section className="neu flex flex-col gap-3 p-6 sm:flex-row sm:items-start" aria-labelledby="cc-join-addon">
              <Package aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 shrink-0 text-accent" />
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-semibold text-mutedtext">{t("addonTitle")}</p>
                <h2 id="cc-join-addon" className="title-card">
                  {pick(locale, catalog.addon.name_en, catalog.addon.name_ar)}
                </h2>
                <p className="text-sm text-body">{pick(locale, catalog.addon.who_for_en, catalog.addon.who_for_ar)}</p>
                <ul className="list-disc space-y-1 ps-5 text-sm text-body">
                  {(locale === "ar" && catalog.addon.includes_ar.length ? catalog.addon.includes_ar : catalog.addon.includes_en).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <p className="text-sm font-semibold text-ink">
                  {showPrices && catalog.addon.price_qar != null ? <Ltr>{formatQAR(catalog.addon.price_qar, locale)}</Ltr> : showPrices ? t("priceSoon") : t("pricesAfterTest")}
                  {showPrices && catalog.addon.price_qar != null ? ` · ${t("addonText")}` : ""}
                </p>
              </div>
            </section>
          ) : null}
        </>
      )}

      <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="cc-join-faq">
        <h2 id="cc-join-faq" className="title-section">
          {tFaq("title")}
        </h2>
        <div className="space-y-2">
          {faq.map(([q, a]) => (
            <details key={q} className="tile group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-bold text-ink">
                {tFaq(q)}
                <span aria-hidden="true" className="text-accent transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm text-body">
                {tFaq(a)}
                {q === "q3" ? (
                  <>
                    {" "}
                    <Link href={ccPath(locale, "/terms")} className="font-semibold text-accent underline-offset-2 hover:underline">
                      {tFaq("refundLink")}
                    </Link>
                  </>
                ) : null}
              </p>
            </details>
          ))}
        </div>
        <Button asChild variant="ghost">
          <a href={wa ?? `mailto:${supportEmail}`} target={wa ? "_blank" : undefined} rel={wa ? "noopener noreferrer" : undefined}>
            <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("questions")}
          </a>
        </Button>
      </section>

      <SignedInExtras pageName={t("title")} />
    </div>
  );
}
