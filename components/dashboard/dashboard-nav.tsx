"use client";

import { useLocale } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// Sub-nav for the protected dashboard area. Active state via the locale-stripped
// pathname from next-intl (e.g. "/dashboard/inventory").
export function DashboardNav({
  items,
}: {
  items: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const locale = useLocale();
  const isRtl = locale === "ar";

  return (
    <nav className="flex items-center gap-1">
      {items.map((item) => {
        const active =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-lg px-3 py-2 transition-colors duration-300",
              isRtl
                ? "text-sm font-medium"
                : "font-mono text-[11px] uppercase tracking-wider",
              active
                ? "bg-panel text-heading shadow-neu-sm"
                : "text-mutedtext hover:text-heading"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
