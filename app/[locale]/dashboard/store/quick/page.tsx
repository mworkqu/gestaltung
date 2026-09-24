import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { QuickEntry } from "@/components/admin/quick-entry";
import type { Supplier } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

// Fast product entry with Google Drive images (Task 17). super_admin only
// (store layout).

export const dynamic = "force-dynamic";

export default async function QuickEntryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("QuickEntry");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [suppliersRes, partsRes] = await Promise.all([
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("parts").select("category, attributes").limit(10000),
  ]);

  // The attribute class most used in each category pre-selects the class.
  const counts = new Map<string, Map<string, number>>();
  for (const p of (partsRes.data ?? []) as { category: string; attributes: { class?: string } | null }[]) {
    const m = counts.get(p.category) ?? new Map<string, number>();
    const c = p.attributes?.class;
    if (c) m.set(c, (m.get(c) ?? 0) + 1);
    counts.set(p.category, m);
  }
  const classByCategory: Record<string, string> = {};
  for (const [cat, m] of counts) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) classByCategory[cat] = top[0];
  }

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("intro")}</p>
      </div>
      {suppliersRes.error ? (
        <p className="neu p-6 text-sm text-mutedtext">{t("needsMigration")}</p>
      ) : (
        <QuickEntry
          locale={locale}
          suppliers={(suppliersRes.data ?? []) as Supplier[]}
          categories={[...counts.keys()].sort()}
          classByCategory={classByCategory}
        />
      )}
    </div>
  );
}
