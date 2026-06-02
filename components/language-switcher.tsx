"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher({
  currentLocale,
}: {
  currentLocale: Locale;
}) {
  const t = useTranslations("LanguageSwitcher");
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const nextLocale: Locale = currentLocale === "en" ? "ar" : "en";
  const label =
    nextLocale === "ar" ? t("switchToArabic") : t("switchToEnglish");

  function switchTo(locale: Locale) {
    startTransition(() => {
      router.replace(pathname, { locale });
    });
  }

  return (
    <div className="flex items-center gap-1" aria-label={t("label")}>
      {routing.locales.map((loc) => {
        const isActive = loc === currentLocale;
        const text = loc === "ar" ? "العربية" : "EN";
        return (
          <Button
            key={loc}
            type="button"
            size="sm"
            variant={isActive ? "secondary" : "ghost"}
            onClick={() => !isActive && switchTo(loc)}
            disabled={isPending && !isActive}
            aria-pressed={isActive}
            aria-label={
              loc === "ar" ? t("switchToArabic") : t("switchToEnglish")
            }
            className={
              loc === "ar"
                ? "font-arabic text-sm leading-none"
                : "text-xs font-semibold tracking-wider"
            }
          >
            {text}
          </Button>
        );
      })}
      <span className="sr-only">{label}</span>
    </div>
  );
}
