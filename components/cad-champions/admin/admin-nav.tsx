"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  GraduationCap,
  HeartPulse,
  Home,
  LayoutTemplate,
  LifeBuoy,
  Mail,
  Menu,
  MessageCircleQuestion,
  PlayCircle,
  Rocket,
  Settings2,
  Tags,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { activeNavId, navForRole } from "@/lib/cad-champions/admin/nav";
import { ccPath, parseCcPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  today: Home,
  review: ClipboardCheck,
  questions: MessageCircleQuestion,
  students: Users,
  tests: ClipboardList,
  exercises: Wrench,
  lessons: PlayCircle,
  "get-ready": Rocket,
  help: LifeBuoy,
  glossary: BookOpen,
  landing: LayoutTemplate,
  plans: Tags,
  emails: Mail,
  health: HeartPulse,
  payments: Wallet,
  insights: BarChart3,
  operations: Settings2,
};

function NavList({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const t = useTranslations("CC.admin.nav");
  const locale = useLocale() as Locale;
  const pathname = usePathname() ?? "";
  const active = activeNavId(parseCcPath(pathname)?.rest ?? "");
  return (
    <div className="space-y-5">
      {navForRole(isAdmin).map((g) => (
        <div key={g.id} className="space-y-1">
          {g.labelKey ? <p className="px-3 text-xs font-semibold uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">{t(`groups.${g.labelKey}`)}</p> : null}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const Icon = ICONS[i.id] ?? FileQuestion;
              const on = active === i.id;
              return (
                <li key={i.id}>
                  <Link
                    href={ccPath(locale, i.path)}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      on ? "bg-surface text-accent shadow-neu-sm" : "text-body hover:bg-panel hover:text-ink",
                    )}
                  >
                    <Icon aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
                    {t(i.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Side nav (lg+) and a menu disclosure on phones/tablets. */
export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("CC.admin.nav");
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="cc-admin-nav-mobile"
          onClick={() => setOpen((v) => !v)}
          className="neu flex min-h-11 w-full items-center gap-2 px-4 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Menu aria-hidden="true" className="h-4 w-4" />
          {t("menu")}
          <GraduationCap aria-hidden="true" className="ms-auto h-4 w-4 text-accent" />
        </button>
        {open ? (
          <nav id="cc-admin-nav-mobile" aria-label={t("label")} className="neu mt-2 p-3">
            <NavList isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
          </nav>
        ) : null}
      </div>
      <nav aria-label={t("label")} className="neu sticky top-4 hidden max-h-[calc(100dvh-2rem)] overflow-y-auto p-3 lg:block">
        <p className="mb-3 px-3 text-sm font-extrabold text-heading">{t("title")}</p>
        <NavList isAdmin={isAdmin} />
      </nav>
    </>
  );
}
