import { getTranslations, setRequestLocale } from "next-intl/server";

import { cn } from "@/lib/utils";
import { QuoteRequest } from "@/components/design/quote-request";

// Public quote-request page. The homepage dropzone hands off a CAD file here;
// this page collects the visitor's email/phone + preferred method and submits a
// lead (no sign-in). Kept out of the authenticated job flow at /design/upload.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "DesignQuote" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function DesignQuotePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("DesignQuote");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <div className="container py-10">
      <div className="mx-auto max-w-2xl">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
        </span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
          {t("heading")}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-body sm:text-base">
          {t("subheading")}
        </p>

        <QuoteRequest />
      </div>
    </div>
  );
}
