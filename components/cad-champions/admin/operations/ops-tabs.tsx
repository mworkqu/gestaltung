import Link from "next/link";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

export type OpsTab = "announcements" | "audit" | "deletions";

const TABS: { id: OpsTab; path: string }[] = [
  { id: "announcements", path: "/admin/operations" },
  { id: "audit", path: "/admin/operations/audit" },
  { id: "deletions", path: "/admin/operations/deletions" },
];

/** The three Operations pages as one tab bar (server component; plain links). */
export async function OpsTabs({ locale, active }: { locale: Locale; active: OpsTab }) {
  const t = await getTranslations({ locale, namespace: "CC.admin.operations" });
  return (
    <nav aria-label={t("tabs.label")} className="flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={ccPath(locale, tab.path)}
          aria-current={tab.id === active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            tab.id === active ? "bg-accent text-accent-foreground shadow-neu-sm" : "bg-surface text-ink shadow-neu-sm hover:shadow-neu",
          )}
        >
          {t(`tabs.${tab.id}`)}
        </Link>
      ))}
    </nav>
  );
}
