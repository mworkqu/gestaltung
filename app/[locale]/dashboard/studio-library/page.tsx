import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { StudioLibraryList, type LibraryRow } from "@/components/admin/studio-library/library-list";
import { LIBRARY } from "@/lib/studio/library";
import { adminRows } from "@/lib/studio/library/admin-rows";
import type { StudioPartRow } from "@/lib/studio/library/merge";

// Studio library admin (P5-15c): every part the Design Studio can pick, the
// owner's edits (studio_parts, migration 0070) and a quick store-SKU link per
// part. Reads all rows as the signed-in super admin (RLS). Before 0070 runs the
// page lists the code parts read-only with "Run migration 0070 to save edits".
export const dynamic = "force-dynamic";

const MISSING = new Set(["42P01", "PGRST205"]);

export default async function StudioLibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("StudioLibrary");

  const supabase = await createClient();
  const { data, error } = await supabase.from("studio_parts").select("id, data, enabled, updated_at").order("id");
  const readOnly = !!error;
  if (error && !MISSING.has(error.code ?? "")) console.error("[studio-library] read failed:", error.code, error.message);

  const rows: LibraryRow[] = adminRows(LIBRARY, (data ?? []) as StudioPartRow[]).map((r) => ({
    id: r.id,
    name: locale === "ar" && r.part?.name.ar ? r.part.name.ar : r.name,
    category: r.category,
    source: r.source,
    enabled: r.enabled,
    skus: r.skus.join(", "),
    problems: r.problems,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-heading">{t("pageTitle")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("pageIntro")}</p>
      </div>
      {readOnly && (
        <p className="neu p-4 text-sm font-semibold text-amber-800" role="status">
          {error && MISSING.has(error.code ?? "") ? t("needsMigration") : t("readFailed")}
        </p>
      )}
      <StudioLibraryList locale={locale} rows={rows} readOnly={readOnly} />
    </div>
  );
}
