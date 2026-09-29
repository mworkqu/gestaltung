import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

export async function Footer() {
  const t = await getTranslations("Footer");
  const tNav = await getTranslations("Nav");

  // Only what the header doesn't carry (owner, 2026-09-29: no repeats). The
  // company name + C.R. is already in the strip above the header.
  const links = [
    { href: "/how-it-works", label: tNav("howItWorks") },
    { href: "/about", label: tNav("about") },
    { href: "/contact", label: tNav("contact") },
  ];

  return (
    <footer className="container pb-8 pt-4">
      <div className="neu flex flex-col gap-4 px-6 py-6">
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-start">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-mutedtext transition-colors hover:text-heading"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="border-t border-borderstrong/40 pt-4 text-center text-xs text-mutedtext sm:text-start">
          © 2026 {t("text")}
        </p>
      </div>
    </footer>
  );
}
