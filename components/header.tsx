import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { GMark } from "@/components/g-mark";
import { LanguageSwitcher } from "@/components/language-switcher";

const navLinks = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#store", label: "Store" },
  { href: "#about", label: "About" },
];

export function Header({ locale }: { locale: Locale }) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5">
          <GMark className="h-8 w-8" />
          <span className="text-base font-semibold tracking-[0.14em] text-heading">
            Gestaltung
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-mutedtext transition-colors hover:text-heading"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher currentLocale={locale} />
          <Button asChild size="sm" className="h-9 px-4">
            <a href="#upload">Upload a file</a>
          </Button>
        </div>
      </div>
    </header>
  );
}
