"use client";

// Tab bar for pages that belong to one sidebar item (D2): Products (catalog /
// add / specs), Restock, Discounts & occasions, Suppliers. Each tab is its own
// route, so old deep links keep working; the bar only appears on a tab's own
// URL (not on edit/new pages below it).

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { tabSetFor, type NavTabSet } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

export function DashboardTabs({ sets }: { sets: NavTabSet[] }) {
  const pathname = usePathname();
  const t = useTranslations("DashboardNav");
  const set = tabSetFor(pathname, sets);
  if (!set) return null;

  return (
    <nav aria-label={t("tabsLabel")} className="mb-6 overflow-x-auto overscroll-x-contain">
      <ul className="inline-flex min-w-full gap-1 rounded-2xl bg-panel p-1 shadow-neu-inset sm:min-w-0">
        {set.tabs.map((tab) => {
          const active = tab.href === pathname.replace(/\/$/, "");
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center whitespace-nowrap rounded-xl px-4 text-sm transition-colors",
                  active ? "bg-surface font-semibold text-heading shadow-neu-sm" : "text-mutedtext hover:text-heading"
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
