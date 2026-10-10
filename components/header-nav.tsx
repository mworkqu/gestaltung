"use client";

// Site navigation (audit #13, #53; owner decision 8a): Shop parts · Get a part
// made · Plan a product for everyone; My projects once the visitor has a session
// (a guest who started a project too); Inventory + Dashboard + Sign out for a
// signed-in account. Desktop: links + account menu. Under 1024 px: a menu
// button opening a panel with everything.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, LogOut, Menu, User, X } from "lucide-react";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { track } from "@/lib/analytics";
import { loadSupabase } from "@/lib/supabase/lazy";
import { cn } from "@/lib/utils";

type Session = { kind: "none" | "guest" | "account"; email?: string | null };

// `credits` (the credit-balance chip) shows in the bar from sm up and inside the
// mobile menu below sm, where the bar has no room for it at 375 px.
export function HeaderNav({
  isRtl,
  children,
  credits,
}: {
  isRtl: boolean;
  children?: React.ReactNode;
  credits?: React.ReactNode;
}) {
  const t = useTranslations("Nav");
  const tAuth = useTranslations("Auth");
  const pathname = usePathname();
  const router = useRouter();
  // Who is asking comes from the shared <AuthProvider> (one read for the whole page).
  const { user: authUser } = useAuth();
  const session: Session = !authUser
    ? { kind: "none" }
    : authUser.is_anonymous
      ? { kind: "guest" }
      : { kind: "account", email: authUser.email };
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

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
    await (await loadSupabase()).auth.signOut();
    router.push("/");
    router.refresh();
  }

  // The site's three paths (owner, 2026-09-29) — nothing else in the bar.
  // Projects and inventory live behind the account menu.
  const primary = [
    { href: "/store", label: t("pathBuy"), path: "shop" as const },
    { href: "/design", label: t("pathMake"), path: "make" as const },
    { href: "/projects/new", label: t("pathIdea"), path: "plan" as const },
  ];
  const accountLinks = [
    { href: "/projects", label: t("myProjects") },
    { href: "/orders", label: t("myOrders") },
    { href: "/my-inventory", label: t("myInventory") },
    { href: "/dashboard", label: t("dashboard") },
  ];
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const linkClass = (href: string) =>
    cn(
      "rounded-lg px-3 py-2 transition-colors duration-300 hover:text-heading max-lg:inline-flex max-lg:min-h-11 max-lg:items-center",
      active(href) ? "text-heading" : "text-mutedtext",
      isRtl ? "text-sm font-medium" : "font-mono text-[11px] uppercase tracking-wider"
    );

  return (
    <>
      <nav className="hidden items-center gap-1 lg:flex" aria-label={t("menu")}>
        {primary.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={() => track("path_chosen", { path: l.path })}
            className={linkClass(l.href)}
            aria-current={active(l.href) ? "page" : undefined}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
      <div className="max-sm:hidden empty:hidden">{credits}</div>
      {children}
      {/* Account: Sign in, or a menu with Dashboard + Sign out. */}
      <div className="hidden lg:block" ref={accountRef}>
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
                {accountLinks.map((l) => (
                  <Link key={l.href} role="menuitem" href={l.href} className="block rounded-lg px-3 py-2 text-sm text-heading hover:bg-panel">
                    {l.label}
                  </Link>
                ))}
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
        className="flex h-9 w-9 items-center justify-center rounded-lg text-heading shadow-neu-sm max-lg:h-11 max-lg:w-11 lg:hidden"
      >
        {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
      </div>
      {menuOpen && (
        <div id="mobile-menu" className="neu absolute inset-x-4 top-full z-50 mt-2 max-h-[calc(100dvh-8rem)] space-y-1 overflow-y-auto p-3 lg:hidden">
          {credits && <div className="px-1 pb-1 sm:hidden empty:hidden [&_a]:min-h-11">{credits}</div>}
          {primary.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => track("path_chosen", { path: l.path })}
              className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-heading hover:bg-panel"
            >
              {l.label}
            </Link>
          ))}
          <div className="my-1 border-t border-borderstrong/40" />
          {session.kind === "account" ? (
            <>
              {accountLinks.map((l) => (
                <Link key={l.href} href={l.href} className="flex min-h-11 items-center rounded-lg px-3 text-sm text-heading hover:bg-panel">
                  {l.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={signOut}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-sm text-heading hover:bg-panel"
              >
                <LogOut className={cn("h-4 w-4", isRtl && "rotate-180")} aria-hidden />
                {tAuth("signOut")}
              </button>
            </>
          ) : (
            <Link href="/sign-in" className="flex min-h-11 items-center rounded-lg px-3 text-sm text-heading hover:bg-panel">
              {t("signIn")}
            </Link>
          )}
        </div>
      )}
    </>
  );
}
