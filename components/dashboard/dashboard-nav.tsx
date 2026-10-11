"use client";

// Dashboard navigation. Owner, 2026-10-11 (D2): four groups (Today · Sell ·
// Build · Settings), an icon per item, a count badge where something waits
// (orders, products to fix, new messages, reviews), "Back to website" at the
// very top, and a sidebar that scrolls on its own so it never runs off a short
// screen. Phones get one "Menu" button with the same list in a scrolling
// drawer. Active state: the longest matching route wins (lib/admin/nav.ts), so
// /dashboard/store/suppliers lights up Suppliers, not Products.

import { Suspense, use, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  ClipboardList,
  Coins,
  Cpu,
  FolderKanban,
  Gauge,
  House,
  Inbox,
  Package,
  PackagePlus,
  PackageSearch,
  Star,
  Tag,
  Truck,
  Video,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { activeItemHref, badgeText, type BadgeKey, type NavBadges, type NavGroup, type NavIcon } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

export type { NavGroup } from "@/lib/admin/nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: House,
  orders: ClipboardList,
  products: Package,
  fix: Wrench,
  restock: PackagePlus,
  discounts: Tag,
  reviews: Star,
  leads: Inbox,
  projects: FolderKanban,
  credits: Coins,
  studio: Cpu,
  suppliers: Truck,
  gaps: PackageSearch,
  videos: Video,
  usage: Gauge,
  notifications: Bell,
  inventory: Warehouse,
};

export function DashboardNav({
  groups,
  badges,
}: {
  groups: NavGroup[];
  /** Streamed from the layout (a promise) or given directly (fixtures). */
  badges?: Promise<NavBadges> | NavBadges;
}) {
  const pathname = usePathname();
  const t = useTranslations("DashboardNav");
  const [open, setOpen] = useState(false);
  const desktopRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const all = groups.flatMap((g) => g.items);
  const activeHref = activeItemHref(pathname, all);
  const activeLabel = all.find((i) => i.href === activeHref)?.label ?? t("overview");

  // Keep the current page's item in view inside the scrolling sidebar.
  useEffect(() => {
    const el = desktopRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && desktopRef.current && desktopRef.current.offsetParent !== null) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeHref]);

  useEffect(() => {
    if (!open) return;
    const el = drawerRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [open]);

  const list = (
    <div className="space-y-4">
      <Link
        href="/"
        onClick={() => setOpen(false)}
        className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-mutedtext hover:text-heading"
      >
        <ArrowLeft className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />
        {t("backToSite")}
      </Link>
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-0.5">
          {g.label && (
            <p className="px-3 pb-1 text-[10px] text-faint ltr:font-mono ltr:uppercase ltr:tracking-[0.18em] rtl:font-sans">
              {g.label}
            </p>
          )}
          {g.items.map((item) => {
            const Icon = item.icon ? ICONS[item.icon] : null;
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors max-lg:min-h-11",
                  active ? "bg-panel font-semibold text-heading shadow-neu-sm" : "text-mutedtext hover:text-heading"
                )}
              >
                {Icon && <Icon className={cn("h-4 w-4 shrink-0", active ? "text-cobalt" : "text-faint")} strokeWidth={1.75} aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge && badges && (
                  <Suspense fallback={null}>
                    <NavBadge badges={badges} k={item.badge} />
                  </Suspense>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Phones and tablets: one button, the whole list in a scrolling drawer. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="neu flex min-h-11 w-full items-center justify-between px-4 py-3 text-sm font-semibold text-heading"
        >
          {activeLabel}
          <ChevronDown className={cn("h-4 w-4 text-mutedtext transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {open && (
          <nav
            ref={drawerRef}
            aria-label={t("navLabel")}
            className="neu mt-2 max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain p-3"
          >
            {list}
          </nav>
        )}
      </div>
      <nav
        ref={desktopRef}
        aria-label={t("navLabel")}
        data-testid="dashboard-sidebar"
        className="neu sticky top-6 hidden max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain p-3 lg:block"
      >
        {list}
      </nav>
    </>
  );
}

function isThenable(v: Promise<NavBadges> | NavBadges): v is Promise<NavBadges> {
  return typeof (v as { then?: unknown }).then === "function";
}

function NavBadge({ badges, k }: { badges: Promise<NavBadges> | NavBadges; k: BadgeKey }) {
  const t = useTranslations("DashboardNav");
  const resolved = isThenable(badges) ? use(badges) : badges;
  const count = resolved[k];
  const text = badgeText(count);
  if (!text || count === undefined) return null;
  return (
    <span
      className="ms-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-cobalt px-1.5 text-[11px] font-bold tabular-nums text-white"
      aria-label={t("badgeCount", { count: String(count) })}
    >
      {text}
    </span>
  );
}
