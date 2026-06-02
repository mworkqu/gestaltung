import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { LanguageSwitcher } from "@/components/language-switcher";

export async function Header({ locale }: { locale: Locale }) {
  const t = await getTranslations("Nav");
  const tBrand = await getTranslations("Brand");

  const links = [
    { href: "/", label: t("home") },
    { href: "#how-it-works", label: t("howItWorks") },
    { href: "#store", label: t("store") },
    { href: "#about", label: t("about") },
    { href: "#contact", label: t("contact") },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-md ring-1 ring-border bg-card">
            <Image
              src="/logo.png"
              alt={tBrand("name")}
              width={36}
              height={36}
              priority
              className="h-9 w-9 object-contain"
            />
          </span>
          <span className="text-sm font-semibold tracking-wide text-foreground/90">
            {tBrand("name")}
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher currentLocale={locale} />
        </div>
      </div>
    </header>
  );
}
