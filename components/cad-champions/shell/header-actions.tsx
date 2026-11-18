"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";

import { CcAccountMenu } from "./account-menu";
import { CcLanguageSwitcher } from "./language-switcher";
import { useCcSession } from "./session-context";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

// Right side of the CC header: language switcher plus "Sign in" or the account
// menu. The session is read in the browser (session-context.tsx), so the
// header HTML is the same for everyone and the page can be prerendered. While
// the session loads, a neutral pill of the same height and about the same width
// as the "Sign in" button holds the space, so nothing jumps.
export function CcHeaderActions({ locale }: { locale: Locale }) {
  const t = useTranslations("CC.shell");
  const { status, session } = useCcSession();

  return (
    <>
      <CcLanguageSwitcher locale={locale} signedIn={session !== null} />
      {status === "loading" ? (
        <span aria-hidden="true" data-cc-session-placeholder="" className="inline-flex min-h-11 w-24 rounded-full bg-surface shadow-neu-sm sm:w-28" />
      ) : session ? (
        <CcAccountMenu locale={locale} name={session.name} email={session.email} isStaff={session.isStaff} />
      ) : (
        <Link
          href={ccPath(locale, "/sign-in")}
          className={`inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-neu-sm transition-colors hover:bg-cobalt-hover sm:px-5 ${focus}`}
        >
          {t("signIn")}
        </Link>
      )}
    </>
  );
}
