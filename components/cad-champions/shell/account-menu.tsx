"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, LayoutDashboard, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { Spinner } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { ccSignOut } from "@/lib/cad-champions/auth/actions";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

// Header account menu for a signed-in CC user: Dashboard, Settings (/account),
// Admin (staff only) and Sign out (server action). A disclosure button: Enter /
// Space opens, Esc or a click outside closes and returns focus.
export function CcAccountMenu({
  locale,
  name,
  email,
  isStaff,
}: {
  locale: Locale;
  name: string | null;
  email: string | null;
  isStaff: boolean;
}) {
  const t = useTranslations("CC.auth.menu");
  const [open, setOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-heading transition-colors hover:bg-panel " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const display = name?.trim() || email || "";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("open")}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-3 text-sm font-semibold text-heading shadow-neu-sm transition-shadow hover:shadow-neu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <UserRound aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="hidden max-w-[10rem] truncate sm:inline">{display}</span>
        <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={1.75} />
      </button>

      {open ? (
        <div
          id={menuId}
          className="absolute end-0 top-full z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/60 bg-surface p-2 shadow-neu"
        >
          {email ? (
            <p className="truncate px-3 pb-2 pt-1 text-xs text-mutedtext">
              <Ltr>{email}</Ltr>
            </p>
          ) : null}
          <ul className="space-y-1">
            <li>
              <Link href={ccPath(locale, "/dashboard")} className={item} onClick={() => setOpen(false)}>
                <LayoutDashboard aria-hidden className="h-4 w-4 shrink-0 text-mutedtext" strokeWidth={1.75} />
                {t("dashboard")}
              </Link>
            </li>
            <li>
              <Link href={ccPath(locale, "/account")} className={item} onClick={() => setOpen(false)}>
                <Settings aria-hidden className="h-4 w-4 shrink-0 text-mutedtext" strokeWidth={1.75} />
                {t("settings")}
              </Link>
            </li>
            {isStaff ? (
              <li>
                <Link href={ccPath(locale, "/admin")} className={item} onClick={() => setOpen(false)}>
                  <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-mutedtext" strokeWidth={1.75} />
                  {t("admin")}
                </Link>
              </li>
            ) : null}
            <li className="border-t border-white/60 pt-1">
              <form
                action={async () => {
                  setSigningOut(true);
                  await ccSignOut(locale);
                }}
              >
                <button type="submit" className={item} disabled={signingOut} aria-busy={signingOut || undefined}>
                  {signingOut ? (
                    <Spinner size="sm" label={t("signingOut")} />
                  ) : (
                    <>
                      <LogOut aria-hidden className="h-4 w-4 shrink-0 text-mutedtext rtl:-scale-x-100" strokeWidth={1.75} />
                      {t("signOut")}
                    </>
                  )}
                </button>
              </form>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
