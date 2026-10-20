import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { SchoolPricingEditor } from "@/components/admin/school-pricing-editor";
import { parseSchoolPricing, SCHOOL_PRICING_KEY } from "@/lib/schools/pricing";

// School prices (store_settings.school_pricing): what a teacher is quoted on
// /schools and on their class page. super_admin only (the store layout redirects
// everyone else). Read as the signed-in admin; the editor saves through
// saveSchoolPricing().
export const dynamic = "force-dynamic";

export default async function SchoolsSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("SchoolsAdmin");

  const supabase = await createClient();
  const { data } = await supabase.from("store_settings").select("value").eq("key", SCHOOL_PRICING_KEY).maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-heading">{t("heading")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("intro")}</p>
      </div>
      <SchoolPricingEditor locale={locale} initial={parseSchoolPricing(data?.value)} />
    </div>
  );
}
