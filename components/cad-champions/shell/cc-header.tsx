import Link from "next/link";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";

import { CcAccountMenu } from "./account-menu";
import { CcLanguageSwitcher } from "./language-switcher";
import { CcMark } from "./cc-mark";

/** What the header needs to know about the visitor (from getCcUser() in the CC layout). */
export type CcHeaderSession = {
  name: string | null;
  email: string | null;
  isStaff: boolean;
} | null;

// CAD Champions header: wordmark (home), language switcher, and "Sign in"
// when signed out or the account menu (Dashboard, Settings, Sign out) when
// signed in. Server component; the CC layout passes the session.
export async function CcHeader({ locale, session = null }: { locale: Locale; session?: CcHeaderSession }) {
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
          <CcLanguageSwitcher locale={locale} signedIn={session !== null} />
          {session ? (
            <CcAccountMenu locale={locale} name={session.name} email={session.email} isStaff={session.isStaff} />
          ) : (
            <Link
              href={ccPath(locale, "/sign-in")}
              className={`inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-neu-sm transition-colors hover:bg-cobalt-hover sm:px-5 ${focus}`}
            >
              {t("signIn")}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
