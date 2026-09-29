import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { LogoMark } from "@/components/logo-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { HeaderNav } from "@/components/header-nav";
import { CartIcon } from "@/components/parts/cart-icon";
import { cn } from "@/lib/utils";
import { CompanyStrip } from "@/components/company-strip";

export async function Header({ locale }: { locale: Locale }) {
  const tBrand = await getTranslations("Brand");
  const isRtl = locale === "ar";

  return (
    <header className="sticky top-0 z-40 w-full">
      <div className="border-b border-borderstrong/40 bg-panel/80 py-1.5 backdrop-blur">
        <CompanyStrip className="container" />
      </div>
      <div className="container pt-4">
        <div className="neu relative flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
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

          <HeaderNav isRtl={isRtl}>
            <CartIcon />
            <LanguageSwitcher currentLocale={locale} />
          </HeaderNav>
        </div>
      </div>
    </header>
  );
}
