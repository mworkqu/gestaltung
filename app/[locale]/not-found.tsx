import { getLocale, getTranslations } from "next-intl/server";
import { MessageCircle, Search } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { COMPANY_WHATSAPP } from "@/lib/company";
import { cn } from "@/lib/utils";

// Branded 404 for everything under a locale: unknown URLs (via the
// [...rest] catch-all) and notFound() calls such as an unknown product SKU.
// Rendered inside the locale layout, so the site header and footer are here.
export default async function LocaleNotFound() {
  const locale = await getLocale();
  const t = await getTranslations("NotFound");
  const isRtl = locale === "ar";

  const linkBtn =
    "inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors";

  return (
    <div className="container py-10">
      <section className="neu animate-fade-up mx-auto flex max-w-2xl flex-col gap-6 p-8 text-center sm:p-12">
        <span
          className={cn(
            "mx-auto inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 text-[10px] text-mutedtext shadow-neu-sm",
            isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]"
          )}
        >
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          {t("kicker")}
        </span>
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-heading sm:text-4xl">
          {t("message")}
        </h1>

        <form action={`/${locale}/store`} method="get" role="search" className="space-y-2 text-start">
          <label htmlFor="nf-q" className="block text-sm font-semibold text-heading">
            {t("searchLabel")}
          </label>
          <div className="flex gap-2">
            <input
              id="nf-q"
              name="q"
              type="search"
              placeholder={t("searchPlaceholder")}
              className="neu-inset min-h-11 min-w-0 flex-1 rounded-xl px-4 text-base text-heading placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            />
            <button
              type="submit"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-cobalt px-5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover"
            >
              <Search className="h-4 w-4" aria-hidden />
              {t("searchButton")}
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/store" className={cn(linkBtn, "bg-cobalt text-white hover:bg-cobalt-hover")}>
            {t("storeLink")}
          </Link>
          <Link href="/" className={cn(linkBtn, "bg-panel text-heading shadow-neu-sm hover:text-cobalt")}>
            {t("homeLink")}
          </Link>
        </div>

        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-mutedtext">
          <MessageCircle className="h-4 w-4 text-cobalt" aria-hidden />
          <span>{t("whatsappPrompt")}</span>
          <a
            href={COMPANY_WHATSAPP.url}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="inline-flex min-h-11 items-center font-semibold text-heading underline underline-offset-2 hover:text-cobalt"
          >
            {COMPANY_WHATSAPP.display}
          </a>
        </p>
      </section>
    </div>
  );
}
