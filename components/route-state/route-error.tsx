"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

// Shared body of the route error screens (app/[locale]/{dashboard,projects,orders}/error.tsx).
// Plain words and a retry button; the error and its digest go to the console
// only and are NEVER shown to the visitor.
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("RouteState");

  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="container py-10 sm:py-16">
      <section role="alert" className="neu mx-auto flex max-w-xl flex-col gap-4 p-8 text-center sm:p-10">
        <h1 className="text-2xl font-extrabold leading-tight text-heading sm:text-3xl">{t("errorTitle")}</h1>
        <p className="text-base text-body">{t("errorBody")}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={() => reset()}>
            {t("retry")}
          </Button>
          <Button asChild variant="outline">
            <Link href="/contact">{t("contact")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
