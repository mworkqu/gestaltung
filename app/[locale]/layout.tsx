import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Outfit, JetBrains_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";

import { routing, type Locale } from "@/i18n/routing";
import { siteDefaults } from "@/lib/seo";
import { pickMessages } from "@/lib/i18n/pick-messages";
import { BASE_MESSAGES } from "@/lib/i18n/scopes";
import { Header } from "@/components/header";
import { HeaderGate } from "@/components/header-gate";
import { TrustBlock } from "@/components/trust-block";
import { TrustGate } from "@/components/trust-gate";
import { Footer } from "@/components/footer";
import { AuthProvider } from "@/components/auth/auth-provider";
import { CookieNotice } from "@/components/cookie-notice";
import { CartProvider } from "@/components/parts/cart-provider";
import "../globals.css";

// Fonts (Phase G). Usage audit: the site uses weights 400, 500, 600, 700 and 800
// (font-normal / medium / semibold / bold / extrabold) and never 300 or 900.
//
// - Outfit and JetBrains Mono are variable fonts, so with no weight option each
//   is ONE woff2 per script covering every weight (before: six @font-face weights
//   for Outfit, two for Mono; the same file, but six rules for the browser).
// - IBM Plex Sans Arabic is a static family (one file per weight). Only 400 and
//   700 are loaded; CSS maps 500 to 400 and 600/800 to 700, so medium text looks
//   regular and semibold looks bold in Arabic. That drops two ~33 KB files.
// - Only Outfit (latin) is preloaded. Preloading is decided per layout, not per
//   locale, so the Arabic face cannot be preloaded on /ar without also preloading
//   it on /en; it loads as soon as the CSS is parsed instead (display: swap with
//   a size-adjusted fallback, so the swap does not move the layout).
const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  preload: false,
});

const sansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "700"],
  variable: "--font-sans-ar",
  display: "swap",
  preload: false,
});

// Sitewide default title and description, in the visitor's language. Written
// for customers (shop parts, get a part made, plan a product); pages override
// it with their own generateMetadata.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  // Icons come from the file conventions in app/ (icon.svg, favicon.ico,
  // apple-icon.tsx) and the web manifest from app/manifest.ts, so nothing is
  // listed here.
  return siteDefaults({ locale, title: t("siteTitle"), description: t("siteDescription") });
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);
  // Only the site chrome's client messages go to the browser here; pages add
  // their own with <MessagesScope> (lib/i18n/scopes.ts explains the scheme).
  const messages = pickMessages(await getMessages(), BASE_MESSAGES);

  const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr";

  // GA4 (owner decision D7): the ID is only handed to <CookieNotice>, which adds
  // gtag.js after the visitor presses Accept. Nothing from Google is in the page
  // or requested before that. Unset locally / in previews = never loads.
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${sans.variable} ${mono.variable} ${sansArabic.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-body">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider>
            <CartProvider>
              <div className="flex min-h-screen flex-col">
                <HeaderGate>
                  <Header locale={locale as Locale} />
                </HeaderGate>
                <main className="flex-1">{children}</main>
                {/* P1-04: trust block above the footer; hidden where the header is hidden and on /trust. */}
                <TrustGate>
                  <TrustBlock />
                </TrustGate>
                <Footer />
              </div>
            </CartProvider>
          </AuthProvider>
          <CookieNotice gaId={gaId} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
