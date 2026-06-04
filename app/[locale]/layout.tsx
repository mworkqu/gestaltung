import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Outfit, JetBrains_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";

import { routing, type Locale } from "@/i18n/routing";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import "../globals.css";

const sans = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const sansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-ar",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gestaltung — Manufacturing, made simple in Qatar",
  description:
    "Gestaltung is a manufacturing marketplace and inventory platform for Qatar. Upload a CAD file, we match it to the right production method and partner workshop, and deliver the finished part.",
  icons: {
    icon: "/icon.png",
  },
};

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
  const messages = await getMessages();

  const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${sans.variable} ${mono.variable} ${sansArabic.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-body">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <div className="flex min-h-screen flex-col">
            <Header locale={locale as Locale} />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
