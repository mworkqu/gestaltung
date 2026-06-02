import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { cn } from "@/lib/utils";

export async function Header({ locale }: { locale: Locale }) {
  const t = await getTranslations("Nav");
  const tBrand = await getTranslations("Brand");
  const isRtl = locale === "ar";

  const navLinks = [
    { href: "/how-it-works", label: t("howItWorks") },
    { href: "/about", label: t("about") },
    { href: "/contact", label: t("contact") },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt={tBrand("name")}
            width={32}
            height={32}
            priority
            className="h-8 w-8 object-contain"
          />
          <span
            className={cn(
              "text-base font-semibold text-heading",
              !isRtl && "tracking-[0.14em]"
            )}
          >
            {tBrand("name")}
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-mutedtext transition-colors hover:text-heading"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher currentLocale={locale} />
          <Button asChild size="sm" className="h-9 px-4">
            <Link href="/contact">{t("uploadFile")}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
