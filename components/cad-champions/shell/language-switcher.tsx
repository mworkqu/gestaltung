"use client";

import { usePathname } from "next/navigation";
import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { CC_EVENTS, track } from "@/lib/cad-champions/analytics";
import { setPreferredLocale } from "@/lib/cad-champions/auth/actions";
import { ccPublicPathname } from "@/lib/cad-champions/cc-routing";
import { writeCcLocaleCookie } from "@/lib/cad-champions/locale";
import { ccSwitchLocale } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

// The same CC page in the other language. A full page load (plain <a>) so the
// site's [locale] layout re-renders <html lang dir> for the new language.
// The query string and hash are kept on click (not in the href, so the static
// page needs no useSearchParams / Suspense).
// Signed in: the choice is also saved to cc_profiles.preferred_locale (server
// action). The navigation waits for it at most SAVE_WAIT_MS, so a slow save
// never blocks the switch; the cookie is written either way.
const SAVE_WAIT_MS = 1500;

export function CcLanguageSwitcher({
  locale,
  className,
  signedIn = false,
}: {
  locale: Locale;
  className?: string;
  signedIn?: boolean;
}) {
  const t = useTranslations("CC.shell.language");
  const to: Locale = locale === "ar" ? "en" : "ar";
  // usePathname() is the public URL in the browser; a prerendered page's server
  // HTML may carry the internal /{locale}/cad-champions form — normalise both.
  const href = ccSwitchLocale(ccPublicPathname(usePathname()), to);

  return (
    <a
      href={href}
      hrefLang={to}
      lang={to}
      title={t("switchTitle")}
      onClick={(e) => {
        writeCcLocaleCookie(to);
        track(CC_EVENTS.languageSwitched, { from: locale, to });
        const extra = window.location.search + window.location.hash;
        if (signedIn) {
          e.preventDefault();
          const save = setPreferredLocale(to).catch(() => ({ ok: false }));
          const wait = new Promise((resolve) => window.setTimeout(resolve, SAVE_WAIT_MS));
          void Promise.race([save, wait]).then(() => window.location.assign(href + extra));
          return;
        }
        if (extra) {
          e.preventDefault();
          window.location.assign(href + extra);
        }
      }}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-heading transition-colors hover:bg-panel hover:text-cobalt",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        className,
      )}
    >
      <Languages aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
      <span>{t("switchTo")}</span>
    </a>
  );
}
