"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({
  currentLocale,
}: {
  currentLocale: Locale;
}) {
  const t = useTranslations("LanguageSwitcher");
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(locale: Locale) {
    if (locale === currentLocale) return;
    startTransition(() => {
      router.replace(pathname, { locale });
    });
  }

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card/70 p-0.5"
      aria-label={t("label")}
    >
      {routing.locales.map((loc) => {
        const isActive = loc === currentLocale;
        const text = loc === "ar" ? "ع" : "EN";
        return (
          <button
            key={loc}
            type="button"
            onClick={() => switchTo(loc)}
            disabled={isPending}
            aria-pressed={isActive}
            aria-label={
              loc === "ar" ? t("switchToArabic") : t("switchToEnglish")
            }
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none transition-colors disabled:opacity-60",
              // 44 px targets on phones; below sm only the other language is
              // shown (one button), which saves room in the 375 px header.
              "max-md:min-h-11 max-md:min-w-11",
              isActive && "max-sm:hidden",
              loc === "ar" && "font-arabic text-sm",
              isActive
                ? "bg-azure text-background"
                : "text-mutedtext hover:text-heading"
            )}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
