import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

export async function Footer() {
  const t = await getTranslations("Footer");
  const tNav = await getTranslations("Nav");

  // Secondary nav lives in the footer now that the header is store-first (Store
  // + Design only). Inventory is intentionally NOT here — it's dashboard-only.
  const links = [
    { href: "/store", label: tNav("store") },
    { href: "/design", label: tNav("design") },
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
        <div className="flex flex-col items-center justify-between gap-2 border-t border-borderstrong/40 pt-4 text-center sm:flex-row sm:text-start">
          <span className="text-sm text-mutedtext">{t("text")}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            © 2026 · Grid v4.1
          </span>
        </div>
      </div>
    </footer>
  );
}
