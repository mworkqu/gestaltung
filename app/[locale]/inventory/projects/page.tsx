import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import {
  ProjectPlanner,
  type InventoryLite,
} from "@/components/inventory/project-planner";
import { cn } from "@/lib/utils";

// Project planning over the tenant's inventory. Auth + container come from the
// inventory layout. Current stock is read via RLS (tenant-scoped); the projects
// themselves are browser-local (see ProjectPlanner). No DB migration.
export const dynamic = "force-dynamic";

export default async function InventoryProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Inventory");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const { data } = await supabase
    .from("inventory_items")
    .select("id, sku, name, quantity, unit")
    .order("name", { ascending: true });
  const items = (data ?? []) as InventoryLite[];

  return (
    <div>
      <header className="mb-8">
        <p className={mono("text-[10px] text-cobalt")}>{t("projectsKicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">
          {t("projectsTitle")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-mutedtext">
          {t("projectsSubtitle")}
        </p>
      </header>

      <ProjectPlanner items={items} />
    </div>
  );
}
