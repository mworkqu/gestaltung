import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/logo-mark";
import { Ltr } from "@/components/ltr-isolate";
import { PrintButton } from "@/components/print-button";
import { COMPANY, COMPANY_ADDRESS, COMPANY_WHATSAPP } from "@/lib/company";
import { metaFor } from "@/lib/meta";
import { formatQar } from "@/lib/pricing/plans";
import { getServicePrices } from "@/lib/store/public-catalog";
import { cn } from "@/lib/utils";

export const generateMetadata = metaFor("institutionsProposal");

// The date is rendered when the page is built; rebuild daily so it stays today's.
export const revalidate = 86400;

const EMAIL = "info@gestaltung360.com";

// On paper: one A4 page, no site chrome. The header and trust block are removed
// by their gates (components/header-gate.tsx isPrintSheetPath); the footer is
// hidden here, the cookie bar and the back-to-top button with print:hidden.
const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  html, body { background: #fff !important; }
  footer { display: none !important; }
  main { padding: 0 !important; }
}
`;

// Pilot proposal (P2-05): static server page, no PDF generator. The wording is
// the same as /institutions (Institutions namespace), so the two never drift.
export default async function PilotProposalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, p, tBrand, services] = await Promise.all([
    getTranslations("Institutions"),
    getTranslations("InstitutionsProposal"),
    getTranslations("Brand"),
    getServicePrices(),
  ]);
  const isRtl = locale === "ar";
  const price = formatQar(services.pilot_from);
  // Western digits in Arabic too; Qatar time so the day does not flip at UTC midnight.
  const date = new Intl.DateTimeFormat(isRtl ? "ar-QA-u-nu-latn-ca-gregory" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Qatar",
  }).format(new Date());
  const legalName = isRtl ? COMPANY.legalNameAr : COMPANY.legalNameEn;

  const scope = ["scope1", "scope2", "scope3", "scope4"] as const;
  const kpis = ["kpi1", "kpi2", "kpi3"] as const;
  const h = "text-[11px] font-semibold text-mutedtext print:text-[10px]";
  const li = "flex items-start gap-2 text-sm leading-snug text-heading print:text-[12px]";
  const dot = "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cobalt print:bg-black";
  const box =
    "min-w-0 space-y-1.5 rounded-xl bg-panel p-4 print:rounded-none print:border print:border-neutral-300 print:bg-white print:p-3";

  return (
    <div className="container space-y-4 py-6 print:max-w-none print:space-y-0 print:p-0">
      <style>{PRINT_CSS}</style>

      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/institutions"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
        >
          <ArrowRight className={cn("h-4 w-4", !isRtl && "-scale-x-100")} aria-hidden />
          {p("back")}
        </Link>
        <PrintButton label={p("print")} />
      </div>

      <article
        data-print-sheet
        className="mx-auto w-full max-w-[210mm] space-y-5 rounded-2xl border border-borderstrong/40 bg-white p-5 shadow-neu sm:p-8 print:max-w-none print:space-y-3 print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-borderstrong/60 pb-4 print:pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink">
              <LogoMark title={tBrand("name")} className="h-5 w-5" />
            </span>
            <span className={cn("text-sm font-extrabold text-heading", !isRtl && "uppercase tracking-[0.12em]")}>
              {tBrand("name")}
            </span>
          </div>
          <p className="text-sm text-mutedtext print:text-[12px]">
            {p("date")}: <span className="font-semibold text-heading">{date}</span>
          </p>
        </div>

        <div className="space-y-3 print:space-y-2">
          <h1 className="text-balance text-2xl font-extrabold leading-tight tracking-tight text-heading sm:text-3xl print:text-2xl">
            {p("title")}
          </h1>
          <p className="flex items-end gap-2 text-sm text-heading print:text-[12px]">
            <span className="shrink-0 text-mutedtext">{p("preparedFor")}</span>
            <span className="h-5 min-w-0 flex-1 border-b border-dashed border-borderstrong" aria-hidden />
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
          <section className={box}>
            <h2 className={h}>{t("scopeTitle")}</h2>
            <ul className="space-y-1">
              {scope.map((k) => (
                <li key={k} className={li}>
                  <span className={dot} aria-hidden />
                  {t(k)}
                </li>
              ))}
            </ul>
          </section>

          <div className="grid min-w-0 gap-3 print:gap-2">
            <section className={box}>
              <h2 className={h}>{t("durationTitle")}</h2>
              <p className="text-lg font-bold text-heading print:text-base">{t("durationText")}</p>
            </section>
            <section className={box}>
              <h2 className={h}>{t("priceTitle")}</h2>
              <p className="text-2xl font-extrabold tabular-nums tracking-tight text-heading print:text-xl">
                {t("priceValue", { price })}
              </p>
              <p className="text-xs text-mutedtext">{t("priceNote")}</p>
            </section>
          </div>

          <section className={cn(box, "sm:col-span-2 print:col-span-2")}>
            <h2 className={h}>{t("measureTitle")}</h2>
            <p className="text-xs leading-snug text-mutedtext">{t("measureIntro")}</p>
            <ul className="space-y-1 pt-1">
              {kpis.map((k) => (
                <li key={k} className={li}>
                  <span className={dot} aria-hidden />
                  {t(k)}
                </li>
              ))}
            </ul>
          </section>

          <section className={cn(box, "sm:col-span-2 print:col-span-2")}>
            <h2 className={h}>{t("afterTitle")}</h2>
            <p className="text-sm leading-snug text-heading print:text-[12px]">{t("afterText")}</p>
            <p className="text-xs leading-snug text-mutedtext">{t("invoiceText")}</p>
          </section>
        </div>

        <section className="space-y-2 border-t border-borderstrong/60 pt-4 print:pt-2">
          <h2 className={h}>{p("contactTitle")}</h2>
          <dl className="grid gap-x-6 gap-y-1.5 text-sm text-heading sm:grid-cols-2 print:grid-cols-2 print:text-[12px]">
            <div className="min-w-0">
              <dt className="text-xs text-mutedtext">{p("company")}</dt>
              <dd className="break-words font-semibold">{legalName}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-mutedtext">{p("cr")}</dt>
              <dd className="font-semibold">
                <Ltr>{COMPANY.crNumber}</Ltr>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-mutedtext">{p("address")}</dt>
              <dd>{COMPANY_ADDRESS[isRtl ? "ar" : "en"]}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-mutedtext">{p("whatsapp")}</dt>
              <dd>
                <Ltr>{COMPANY_WHATSAPP.display}</Ltr>
                <span className="text-mutedtext"> · {p("hours")}</span>
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2 print:col-span-2">
              <dt className="text-xs text-mutedtext">{p("email")}</dt>
              <dd className="break-words">
                <Ltr>{EMAIL}</Ltr>
              </dd>
            </div>
          </dl>
        </section>
      </article>
    </div>
  );
}
