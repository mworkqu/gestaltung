"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// Sub-nav for the standalone /inventory area (Items | Projects). Items is the
// default tab, so it's active for everything under /inventory EXCEPT the
// projects subtree.
export function InventoryNav() {
  const t = useTranslations("Inventory");
  const pathname = usePathname();
  const isRtl = useLocale() === "ar";
  const onProjects = pathname.startsWith("/inventory/projects");

  const items = [
    { href: "/inventory", label: t("itemsNav"), active: !onProjects },
    { href: "/inventory/projects", label: t("projectsNav"), active: onProjects },
  ];

  return (
    <nav className="flex items-center gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-lg px-3 py-2 transition-colors duration-300",
            isRtl ? "text-sm font-medium" : "font-mono text-[11px] uppercase tracking-wider",
            item.active
              ? "bg-panel text-heading shadow-neu-sm"
              : "text-mutedtext hover:text-heading"
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
