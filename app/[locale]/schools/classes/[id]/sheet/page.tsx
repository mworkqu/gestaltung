import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/logo-mark";
import { Ltr } from "@/components/ltr-isolate";
import { PrintButton } from "@/components/print-button";
import { createClient } from "@/lib/supabase/server";
import { joinUrl } from "@/lib/schools/join-code";
import { qrSvg } from "@/lib/schools/qr";
import { metaFor } from "@/lib/meta";
import { SITE_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { isMissing } from "../../missing";

// noindex, like the printable pilot proposal (/institutions/proposal).
export const generateMetadata = metaFor("schoolClasses");

// The sheet a teacher pins on the wall (3f). ARABIC FIRST whatever the page
// locale: the students reading it off the wall are in a Qatari classroom, so
// the Arabic line is the big one and the English sits under it.
//
// Print approach copied from app/[locale]/institutions/proposal/page.tsx: one
// A4 page, [data-print-sheet], no site chrome. The header gate does not know
// this path yet (components/header-gate.tsx isPrintSheetPath — see the report),
// so the print rules below also hide the site header and footer themselves.
const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  html, body { background: #fff !important; }
  header, footer { display: none !important; }
  main { padding: 0 !important; }
  .container { max-width: none !important; padding: 0 !important; }
}
`;

type ClassRow = { id: string; name: string; school_name: string; join_code: string };

export default async function ClassSheetPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const isRtl = locale === "ar";
  const supabase = await createClient();

  const [t, tAr, tEn, tSafety, tSafetyEn, tBrand] = await Promise.all([
    getTranslations("SchoolClasses"),
    getTranslations({ locale: "ar", namespace: "SchoolClasses" }),
    getTranslations({ locale: "en", namespace: "SchoolClasses" }),
    getTranslations({ locale: "ar", namespace: "SchoolSafety" }),
    getTranslations({ locale: "en", namespace: "SchoolSafety" }),
    getTranslations("Brand"),
  ]);

  const { data, error } = await supabase
    .from("school_classes")
    .select("id, name, school_name, join_code")
    .eq("id", id)
    .maybeSingle();

  if (isMissing(error)) {
    return (
      <div className="page-stack">
        <h1 className="title-page">{t("sheetTitle")}</h1>
        <section className="neu card-pad">
          <p className="text-sm text-mutedtext">{t("errRunMigration")}</p>
        </section>
      </div>
    );
  }
  if (!data) notFound();
  const klass = data as ClassRow;

  // The link printed on the sheet is the ARABIC one: joinUrl() defaults to /ar.
  const link = joinUrl(SITE_URL, klass.join_code, "ar");
  // Safe to inject: the URL is ours and the markup is generated (see lib/schools/qr.ts).
  const qr = await qrSvg(link, tAr("sheetTitle"));

  return (
    <div className="space-y-4 print:space-y-0 print:p-0">
      <style>{PRINT_CSS}</style>

      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={`/schools/classes/${klass.id}`}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
        >
          <ArrowRight className={cn("h-4 w-4", !isRtl && "-scale-x-100")} aria-hidden />
          {t("backToClasses")}
        </Link>
        <PrintButton label={t("sheetPrint")} />
      </div>

      <article
        data-print-sheet
        dir="rtl"
        className="mx-auto w-full max-w-[210mm] space-y-6 rounded-2xl border border-borderstrong/40 bg-white p-6 text-center shadow-neu sm:p-10 print:max-w-none print:space-y-5 print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        {/* Brand strip */}
        <div className="flex items-center justify-center gap-2 border-b border-borderstrong/60 pb-4 print:pb-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink">
            <LogoMark title={tBrand("name")} className="h-5 w-5" />
          </span>
          <span className="text-sm font-extrabold text-heading">{tBrand("name")}</span>
        </div>

        {/* Title: Arabic big, English under it */}
        <div className="space-y-1">
          <h1 className="text-balance text-3xl font-extrabold leading-tight text-heading sm:text-4xl print:text-3xl">
            {tAr("sheetTitle")}
          </h1>
          <p dir="ltr" className="text-base font-semibold text-mutedtext print:text-sm">
            {tEn("sheetTitle")}
          </p>
          <p className="text-sm text-mutedtext print:text-xs">
            {klass.name} · {klass.school_name}
          </p>
        </div>

        {/* The code and the QR square, side by side on paper */}
        <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-2 print:grid-cols-2 print:gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold text-mutedtext">
              {tAr("sheetCodeLabel")} <span dir="ltr">/ {tEn("sheetCodeLabel")}</span>
            </p>
            <Ltr>
              <span className="block break-all font-mono text-5xl font-extrabold tracking-[0.2em] text-heading print:text-5xl">
                {klass.join_code}
              </span>
            </Ltr>
          </div>
          <div className="mx-auto w-full max-w-[48mm] print:max-w-[42mm]">
            <div
              className="aspect-square w-full [&>svg]:h-full [&>svg]:w-full"
              // The input is our own URL and the SVG is generated by the qrcode
              // package — nothing user-typed reaches this markup.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          </div>
        </div>

        {/* The link */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-mutedtext">
            {tAr("sheetLinkLabel")} <span dir="ltr">/ {tEn("sheetLinkLabel")}</span>
          </p>
          <Ltr>
            <span className="block break-all text-base font-semibold text-heading print:text-sm">{link}</span>
          </Ltr>
        </div>

        {/* Steps */}
        <div className="space-y-1 border-t border-borderstrong/60 pt-4 print:pt-3">
          <p className="text-base leading-relaxed text-heading print:text-sm">{tAr("sheetSteps")}</p>
          <p dir="ltr" className="text-sm leading-relaxed text-mutedtext print:text-xs">
            {tEn("sheetSteps")}
          </p>
        </div>

        {/* Safety */}
        <div className="space-y-1">
          <p className="text-sm font-semibold text-heading print:text-xs">
            {tAr("sheetSafety")} · <span dir="ltr">{tEn("sheetSafety")}</span>
          </p>
          <p className="text-xs leading-relaxed text-mutedtext">{tSafety("bannerMore")}</p>
          <p dir="ltr" className="text-xs leading-relaxed text-mutedtext">
            {tSafetyEn("bannerMore")}
          </p>
        </div>
      </article>
    </div>
  );
}
