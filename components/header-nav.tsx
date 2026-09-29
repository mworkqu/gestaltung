"use client";

// Site navigation (audit #13, #53; owner decision 8a): Shop parts · Make a
// part · How it works for everyone; My projects once the visitor has a session
// (a guest who started a project too); Inventory + Dashboard + Sign out for a
// signed-in account. Desktop: links + account menu. Under 768 px: a menu
// button opening a panel with everything.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, LogOut, Menu, User, X } from "lucide-react";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Session = { kind: "none" | "guest" | "account"; email?: string | null };

export function HeaderNav({ isRtl, children }: { isRtl: boolean; children?: React.ReactNode }) {
  const t = useTranslations("Nav");
  const tAuth = useTranslations("Auth");
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session>({ kind: "none" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    const read = (u: { is_anonymous?: boolean; email?: string | null } | null | undefined) =>
      setSession(!u ? { kind: "none" } : u.is_anonymous ? { kind: "guest" } : { kind: "account", email: u.email });
    supabase.auth.getUser().then(({ data }) => read(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => read(s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Close menus on navigation and on outside click / Escape.
  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (setMenuOpen(false), setAccountOpen(false));
    const onClick = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  const primary = [
    { href: "/store", label: t("shopParts") },
    { href: "/design", label: t("makePart") },
    { href: "/how-it-works", label: t("howItWorks") },
  ];
  const personal = [
    ...(session.kind !== "none" ? [{ href: "/projects", label: t("myProjects") }] : []),
    ...(session.kind === "account" ? [{ href: "/my-inventory", label: t("myInventory") }] : []),
  ];
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const linkClass = (href: string) =>
    cn(
      "rounded-lg px-3 py-2 transition-colors duration-300 hover:text-heading",
      active(href) ? "text-heading" : "text-mutedtext",
      isRtl ? "text-sm font-medium" : "font-mono text-[11px] uppercase tracking-wider"
    );

  return (
    <>
      <nav className="hidden items-center gap-1 md:flex" aria-label={t("menu")}>
        {[...primary, ...personal].map((l) => (
          <Link key={l.href} href={l.href} className={linkClass(l.href)} aria-current={active(l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
      {children}
      {/* Account: Sign in, or a menu with Dashboard + Sign out. */}
      <div className="hidden md:block" ref={accountRef}>
        {session.kind === "account" ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((o) => !o)}
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              className={cn(linkClass("/dashboard"), "inline-flex items-center gap-1")}
            >
              <User className="h-3.5 w-3.5" aria-hidden />
              {t("account")}
              <ChevronDown className="h-3 w-3" aria-hidden />
            </button>
            {accountOpen && (
              <div role="menu" className="neu absolute end-0 top-full z-50 mt-2 w-56 space-y-1 p-2">
                {session.email && <p className="truncate px-3 py-1 text-[11px] text-mutedtext">{session.email}</p>}
                <Link role="menuitem" href="/dashboard" className="block rounded-lg px-3 py-2 text-sm text-heading hover:bg-panel">
                  {t("dashboard")}
                </Link>
                <button
                  role="menuitem"
                  type="button"
                  onClick={signOut}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-heading hover:bg-panel"
                >
                  <LogOut className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} aria-hidden />
                  {tAuth("signOut")}
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link href="/sign-in" className={linkClass("/sign-in")}>
            {t("signIn")}
          </Link>
        )}
      </div>

      {/* Mobile: one button, one panel. */}
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-controls="mobile-menu"
        aria-label={menuOpen ? t("closeMenu") : t("menu")}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-heading shadow-neu-sm md:hidden"
      >
        {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
      </div>
      {menuOpen && (
        <div id="mobile-menu" className="neu absolute inset-x-4 top-full z-50 mt-2 space-y-1 p-3 md:hidden">
          {[...primary, ...personal].map((l) => (
            <Link key={l.href} href={l.href} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-heading hover:bg-panel">
              {l.label}
            </Link>
          ))}
          <div className="my-1 border-t border-borderstrong/40" />
          {session.kind === "account" ? (
            <>
              <Link href="/dashboard" className="block rounded-lg px-3 py-2.5 text-sm text-heading hover:bg-panel">
                {t("dashboard")}
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm text-heading hover:bg-panel"
              >
                <LogOut className={cn("h-4 w-4", isRtl && "rotate-180")} aria-hidden />
                {tAuth("signOut")}
              </button>
            </>
          ) : (
            <Link href="/sign-in" className="block rounded-lg px-3 py-2.5 text-sm text-heading hover:bg-panel">
              {t("signIn")}
            </Link>
          )}
        </div>
      )}
    </>
  );
}
