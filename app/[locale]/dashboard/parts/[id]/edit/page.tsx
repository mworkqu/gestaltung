import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import type { Part } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/server";
import { PartForm } from "@/components/parts/part-form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EditPartPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const { data } = await supabase.from("parts").select("*").eq("id", id).maybeSingle();
  const part = data as Part | null;
  if (!part) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("editTitle")}</h1>
      <div className="neu mt-8 p-6 sm:p-8">
        <PartForm mode="edit" part={part} />
      </div>
    </div>
  );
}
