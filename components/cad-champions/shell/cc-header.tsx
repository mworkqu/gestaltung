import Link from "next/link";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";

import { CcMark } from "./cc-mark";
import { CcHeaderActions } from "./header-actions";

// CAD Champions header: wordmark (home), language switcher, and "Sign in"
// when signed out or the account menu (Dashboard, Settings, Sign out) when
// signed in. Server component with no session read: that part is a client
// component (header-actions.tsx) so the header can be prerendered.
export async function CcHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.shell" });
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="container flex min-h-16 items-center justify-between gap-3 py-2">
        <Link
          href={ccPath(locale, "/")}
          aria-label={t("homeAria")}
          className={`-ms-2 inline-flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 ${focus}`}
        >
          <CcMark />
          <span className="min-w-0 text-sm font-bold leading-tight text-heading sm:text-lg">{t("brand")}</span>
        </Link>

        <nav aria-label={t("headerNav")} className="flex shrink-0 items-center gap-1 sm:gap-2">
          <CcHeaderActions locale={locale} />
        </nav>
      </div>
    </header>
  );
}
