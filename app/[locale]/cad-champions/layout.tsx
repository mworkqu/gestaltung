import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { IBM_Plex_Sans } from "next/font/google";

import { CcDeniedToast } from "@/components/cad-champions/auth/denied-toast";
import { CcFooter } from "@/components/cad-champions/shell/cc-footer";
import { CcHeader } from "@/components/cad-champions/shell/cc-header";
import { ToastProvider } from "@/components/cad-champions/ui";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { ccLayoutMetadata } from "@/lib/cad-champions/metadata";
import { isCcLocale } from "@/lib/cad-champions/routes";
import { pickMessages } from "@/lib/i18n/pick-messages";
import { BASE_MESSAGES } from "@/lib/i18n/scopes";
import { cn } from "@/lib/utils";

// CAD Champions shell. Public URL /cad-champions/{en,ar}/… is rewritten by
// middleware.ts to this internal route, so the site's [locale] layout above
// sets <html lang dir> (ar -> lang="ar" dir="rtl") and the site's Header,
// TrustBlock and Footer are hidden by their gates (lib/cad-champions/cc-routing.ts
// isCcPath). Fonts: IBM Plex Sans for English text, loaded only here (the main
// site's fonts are unchanged); Arabic uses the site's --font-sans-ar.
const ccSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cc-sans",
  display: "swap",
  preload: false,
});

const FONT_STACK = {
  en: "var(--font-cc-sans), ui-sans-serif, system-ui, sans-serif",
  ar: "var(--font-sans-ar), var(--font-cc-sans), ui-sans-serif, system-ui, sans-serif",
} as const;

// Every CC page reads the session (header account menu, Need help), so the whole
// subtree is dynamic. Public CC pages are noindex and cheap; no ISR is lost.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.shell" });
  return ccLayoutMetadata({ locale, brand: t("brand"), description: t("meta.description") });
}

export default async function CadChampionsLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);

  // A nested provider REPLACES the locale layout's messages, so keep the site
  // chrome's base set (cookie notice etc. live outside this subtree, but any
  // site client component rendered here still finds them) and add all CC text.
  // CC client components only read "CC.*" (lib/cad-champions/messages.test.ts).
  const all = await getMessages();
  // "Turnstile": the site's bot-check widget is reused on the CC auth forms.
  const messages = { ...pickMessages(all, [...BASE_MESSAGES, "Turnstile"]), CC: all.CC };
  const t = await getTranslations({ locale, namespace: "CC.shell" });
  // Prompt 2: the header shows "Sign in" or the account menu. Reading the
  // session makes CC pages dynamic (they are noindex and per-user anyway).
  const cc = await getCcUser();
  const session = cc
    ? { name: cc.profile?.full_name ?? null, email: cc.user.email ?? null, isStaff: cc.isStaff }
    : null;

  return (
    <NextIntlClientProvider messages={messages}>
      <div
        data-cc=""
        className={cn(
          ccSans.variable,
          "flex min-h-[100dvh] flex-col bg-background text-body",
          // Site components inside CC that carry `font-sans` keep the CC face.
          "[&_.font-sans]:[font-family:inherit]",
          locale === "ar" ? "leading-[1.7]" : "leading-[1.5]",
        )}
        style={{ fontFamily: FONT_STACK[locale] }}
      >
        <ToastProvider>
          <a
            href="#cc-main"
            className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-accent-foreground"
          >
            {t("skipToContent")}
          </a>
          <CcHeader locale={locale} session={session} />
          <Suspense fallback={null}>
            <CcDeniedToast />
          </Suspense>
          <div id="cc-main" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </div>
          <CcFooter locale={locale} />
        </ToastProvider>
      </div>
    </NextIntlClientProvider>
  );
}
