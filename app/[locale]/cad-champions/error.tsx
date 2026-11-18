"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/cad-champions/ui";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// CC error boundary (500-style). Says what happened in plain words and offers
// Try again / Go to dashboard / Need help. The error message and digest are
// logged to the console only and NEVER shown to the user.
export default function CcError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("CC.errors");
  const raw = useLocale();
  const locale = isCcLocale(raw) ? raw : "en";

  useEffect(() => {
    console.error("[cad-champions] page error", error);
  }, [error]);

  return (
    <div className="container py-10 sm:py-16">
      <section role="alert" className="neu mx-auto flex max-w-2xl flex-col gap-5 p-8 text-center sm:p-12">
        <p className="text-sm font-semibold text-mutedtext">{t("serverError.kicker")}</p>
        <h1 className="text-3xl font-extrabold leading-tight text-heading sm:text-4xl">{t("serverError.title")}</h1>
        <p className="text-base text-body">{t("serverError.body")}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={() => reset()}>
            {t("actions.tryAgain")}
          </Button>
          <Button asChild variant="secondary">
            <Link href={ccPath(locale, "/dashboard")}>{t("actions.goToDashboard")}</Link>
          </Button>
        </div>
        <p className="text-sm text-body">
          <span className="font-semibold text-heading">{t("actions.needHelp")}</span>{" "}
          <Link
            href={ccPath(locale, "/help")}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 font-semibold text-cobalt underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <BookOpen aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("actions.helpCenter")}
          </Link>
        </p>
      </section>
    </div>
  );
}
