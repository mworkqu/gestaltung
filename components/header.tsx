import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/logo-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { HeaderAuthLink } from "@/components/header-auth-link";
import { CartIcon } from "@/components/parts/cart-icon";
import { cn } from "@/lib/utils";

export async function Header({ locale }: { locale: Locale }) {
  const t = await getTranslations("Nav");
  const tBrand = await getTranslations("Brand");
  const isRtl = locale === "ar";

  const navLinks = [
    { href: "/how-it-works", label: t("howItWorks") },
    { href: "/design/drawing", label: t("cadAssistance") },
    { href: "/store", label: t("partsStore") },
    { href: "/about", label: t("about") },
    { href: "/contact", label: t("contact") },
  ];

  return (
    <header className="sticky top-0 z-40 w-full">
      <div className="container pt-4">
        <div className="neu flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          {/* Brand lockup */}
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink shadow-neu-sm">
              <LogoMark title={tBrand("name")} className="h-5 w-5" />
            </span>
            <span className="leading-none">
              <span
                className={cn(
                  "block text-sm font-extrabold text-heading",
                  !isRtl && "uppercase tracking-[0.12em]"
                )}
              >
                {tBrand("name")}
              </span>
              <span
                className={cn(
                  "mt-1 block text-[9px] text-faint",
                  isRtl
                    ? "font-sans"
                    : "font-mono uppercase tracking-[0.18em]"
                )}
              >
                {tBrand("tagline")}
              </span>
            </span>
          </Link>

          {/* Primary nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-mutedtext transition-colors duration-300 hover:text-heading",
                  isRtl
                    ? "text-sm font-medium"
                    : "font-mono text-[11px] uppercase tracking-wider"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <CartIcon />
            <LanguageSwitcher currentLocale={locale} />
            <HeaderAuthLink isRtl={isRtl} />
            <Button asChild size="sm" className="h-9 rounded-full px-4">
              <Link href="/contact">{t("uploadFile")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
