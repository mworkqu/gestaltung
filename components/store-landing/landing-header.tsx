"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { useCart } from "@/components/parts/cart-provider";
import { LogoMark } from "@/components/logo-mark";
import { ThemeToggle } from "@/components/store-landing/theme-toggle";

// Store-landing header from the design handoff. Client component: the cart
// badge, language toggle, theme switch, auth-aware link and mobile menu all
// need state. NOTE: no Inventory link here — inventory (the production/
// multi-tenant stock system) must never appear on the store landing.
export function LandingHeader({ locale }: { locale: Locale }) {
  const t = useTranslations("StoreLanding");
  const tBrand = useTranslations("Brand");
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const { itemCount, ready } = useCart();
  const [signedIn, setSignedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setSignedIn(!!session)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const count = ready ? itemCount : 0;
  const authHref = signedIn ? "/dashboard" : "/sign-in";
  const authLabel = signedIn ? t("dashboard") : t("signIn");

  function switchLocale() {
    startTransition(() => {
      router.replace(pathname, { locale: locale === "ar" ? "en" : "ar" });
    });
  }

  // The code-based brand mark (inline SVG, zero network cost). Its light
  // metallic gradient is designed for a dark plate, so it sits in an ink chip
  // that reads on both the light and dark landing themes.
  const brandMark = (chip: string, mark: string) => (
    <span
      className={`flex ${chip} shrink-0 items-center justify-center rounded-xl bg-[#0a0e15]`}
    >
      <LogoMark title={tBrand("name")} className={mark} />
    </span>
  );

  return (
    <header className="border-b border-[var(--sl-border2)] bg-[var(--sl-header-bg)]">
      {/* Desktop */}
      <div className="hidden items-center justify-between gap-6 px-10 py-4 md:flex">
        <Link href="/" className="flex items-center gap-3">
          {brandMark("h-11 w-11", "h-7 w-7")}
          <span className="flex flex-col leading-[1.1]">
            <span className="sl-heading text-base font-semibold tracking-[0.2px] text-[var(--sl-heading)]">
              {tBrand("name")}
            </span>
            <span className="sl-mono text-[10px] tracking-[0.4px] text-[var(--sl-faint)]">
              {t("tagline")}
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-[22px]">
          <Link
            href="/"
            className="border-b-2 border-[var(--sl-accent)] pb-0.5 text-sm font-medium text-[var(--sl-heading)]"
          >
            {t("navStore")}
          </Link>
          <ThemeToggle />
          <button
            type="button"
            onClick={switchLocale}
            className="sl-mono rounded-md border border-[var(--sl-border)] px-2 py-1 text-xs text-[var(--sl-faint)] transition-colors hover:text-[var(--sl-heading)]"
          >
            {t("langToggle")}
          </button>
          <Link
            href={authHref}
            className="text-sm text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-heading)]"
          >
            {authLabel}
          </Link>
          <Link
            href="/store/cart"
            aria-label={t("cartAria", { count })}
            className="flex items-center gap-[7px] rounded-lg border border-[var(--sl-search-border)] bg-[var(--sl-search-bg)] px-[13px] py-[7px] text-[13px] text-[var(--sl-heading)]"
          >
            <span>{t("cart")}</span>
            <span className="sl-mono flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--sl-accent)] px-[5px] text-[11px] font-medium text-[var(--sl-accent-ink)]">
              {count}
            </span>
          </Link>
        </nav>
      </div>

      {/* Mobile */}
      <div className="flex items-center justify-between gap-3 px-[18px] py-3.5 md:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          {brandMark("h-9 w-9", "h-6 w-6")}
          <span className="sl-heading text-[15px] font-semibold text-[var(--sl-heading)]">
            {tBrand("name")}
          </span>
        </Link>
        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          <button
            type="button"
            onClick={switchLocale}
            className="sl-mono rounded-md border border-[var(--sl-border)] px-[7px] py-[3px] text-[11px] text-[var(--sl-faint)]"
          >
            {t("langToggle")}
          </button>
          <Link
            href="/store/cart"
            aria-label={t("cartAria", { count })}
            className="relative flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-[var(--sl-search-border)] bg-[var(--sl-search-bg)]"
          >
            <span className="h-3 w-[15px] rounded-b-[3px] border-[1.6px] border-t-0 border-[var(--sl-body)]" />
            <span className="sl-mono absolute -top-1.5 -end-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--sl-accent)] px-1 text-[10px] text-[var(--sl-accent-ink)]">
              {count}
            </span>
          </Link>
          <button
            type="button"
            aria-label={t("menuAria")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-5 flex-col gap-1"
          >
            <span className="h-0.5 rounded-sm bg-[var(--sl-body)]" />
            <span className="h-0.5 rounded-sm bg-[var(--sl-body)]" />
            <span className="h-0.5 rounded-sm bg-[var(--sl-body)]" />
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="flex flex-col gap-1 border-t border-[var(--sl-border2)] px-[18px] py-3 md:hidden">
          <Link
            href="/"
            onClick={() => setMenuOpen(false)}
            className="py-2 text-sm font-medium text-[var(--sl-heading)]"
          >
            {t("navStore")}
          </Link>
          <Link
            href={authHref}
            onClick={() => setMenuOpen(false)}
            className="py-2 text-sm text-[var(--sl-muted)]"
          >
            {authLabel}
          </Link>
        </nav>
      )}
    </header>
  );
}
