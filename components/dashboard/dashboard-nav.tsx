"use client";

// Dashboard navigation (owner, 2026-09-29: "the dashboard is super confusing").
// The pages are grouped by job — Customers, Store, Suppliers, Settings — in a
// sidebar on wide screens and a single "Menu" list on phones. Active state
// via the locale-stripped pathname; the longest matching link wins so
// /dashboard/store/suppliers doesn't also light up /dashboard/store.

import { useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type NavGroup = { label?: string; items: { href: string; label: string }[] };

export function DashboardNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("DashboardNav");
  const isRtl = locale === "ar";
  const [open, setOpen] = useState(false);

  const all = groups.flatMap((g) => g.items);
  const activeHref =
    all
      .filter((i) => (i.href === "/dashboard" ? pathname === "/dashboard" : pathname === i.href || pathname.startsWith(`${i.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  const activeLabel = all.find((i) => i.href === activeHref)?.label ?? t("overview");

  const list = (
    <div className="space-y-5">
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-1">
          {g.label && (
            <p className={cn("px-3 text-[10px] text-faint", isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]")}>
              {g.label}
            </p>
          )}
          {g.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={item.href === activeHref ? "page" : undefined}
              className={cn(
                "block rounded-lg px-3 py-2 text-sm transition-colors",
                item.href === activeHref ? "bg-panel font-semibold text-heading shadow-neu-sm" : "text-mutedtext hover:text-heading"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
      <Link href="/" className="flex items-center gap-1.5 px-3 text-xs font-semibold text-mutedtext hover:text-heading">
        <ArrowLeft className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
        {t("backToSite")}
      </Link>
    </div>
  );

  return (
    <>
      {/* Phones and tablets: one button, the whole list. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="neu flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-heading"
        >
          {activeLabel}
          <ChevronDown className={cn("h-4 w-4 text-mutedtext transition-transform", open && "rotate-180")} />
        </button>
        {open && <nav className="neu mt-2 p-3">{list}</nav>}
      </div>
      <nav className="neu sticky top-6 hidden p-3 lg:block">{list}</nav>
    </>
  );
}
