import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MessageCircle } from "lucide-react";

import { COMPANY_WHATSAPP } from "@/lib/company";
import "./globals.css";

// Root fallback: reached only when no locale is known (e.g. an invalid locale
// segment). The root layout is a pass-through, so this renders its own
// <html>/<body>. Shows both languages. Everything under a valid locale gets
// app/[locale]/not-found.tsx instead.
export default async function RootNotFound() {
  const en = await getTranslations({ locale: "en", namespace: "NotFound" });
  const ar = await getTranslations({ locale: "ar", namespace: "NotFound" });

  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-body">
        <main className="container flex min-h-screen items-center justify-center py-10">
          <section className="neu flex w-full max-w-xl flex-col gap-6 p-8 text-center sm:p-12">
            <h1 className="text-3xl font-extrabold tracking-tight text-heading">{en("message")}</h1>
            <p dir="rtl" lang="ar" className="text-2xl font-bold text-heading">
              {ar("message")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/en"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-cobalt px-5 text-sm font-semibold text-white hover:bg-cobalt-hover"
              >
                {en("homeLink")}
              </Link>
              <Link
                href="/ar"
                lang="ar"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-panel px-5 text-sm font-semibold text-heading shadow-neu-sm"
              >
                {ar("homeLink")}
              </Link>
            </div>
            <a
              href={COMPANY_WHATSAPP.url}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="inline-flex min-h-11 items-center justify-center gap-2 text-sm font-semibold text-heading underline underline-offset-2"
            >
              <MessageCircle className="h-4 w-4 text-cobalt" aria-hidden />
              {COMPANY_WHATSAPP.display}
            </a>
          </section>
        </main>
      </body>
    </html>
  );
}
