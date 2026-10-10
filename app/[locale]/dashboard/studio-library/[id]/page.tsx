import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { StudioPartForm } from "@/components/admin/studio-library/part-form";
import { getPart } from "@/lib/studio/library";
import { emptyDraft, partToDraft, type PartDraft } from "@/lib/studio/library/form";
import { BUILDERS } from "@/lib/studio/models";
import { LibraryPartSchema } from "@/lib/studio/schema";

// Add (/dashboard/studio-library/new) or edit one Studio library part (P5-15c).
// Editing a code part with no row yet pre-fills from code. Read-only before 0070.
export const dynamic = "force-dynamic";

const MISSING = new Set(["42P01", "PGRST205"]);

export default async function StudioPartPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("StudioLibrary");
  const isNew = id === "new";
  if (!isNew && !/^[a-z0-9_]+$/.test(id)) notFound();

  const supabase = await createClient();
  const probe = await supabase.from("studio_parts").select("id, data").eq("id", isNew ? "__none__" : id).maybeSingle();
  const readOnly = !!probe.error;
  if (probe.error && !MISSING.has(probe.error.code ?? "")) console.error("[studio-library] read failed:", probe.error.code, probe.error.message);

  let draft: PartDraft = emptyDraft();
  if (!isNew) {
    const row = probe.data as { id: string; data: unknown } | null;
    const parsed = row ? LibraryPartSchema.safeParse({ ...(row.data as object), id }) : null;
    const code = getPart(id);
    if (parsed?.success) draft = partToDraft(parsed.data);
    else if (code) draft = partToDraft(code);
    else if (!row) notFound();
    else draft = { ...emptyDraft(), id };
  }

  const title = isNew ? t("newTitle") : t("editTitle", { name: (locale === "ar" ? draft.nameAr : draft.nameEn) || id });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-heading">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("formIntro")}</p>
      </div>
      <StudioPartForm
        locale={locale}
        initial={draft}
        originalId={isNew ? null : id}
        builders={Object.keys(BUILDERS)}
        readOnly={readOnly}
      />
    </div>
  );
}
