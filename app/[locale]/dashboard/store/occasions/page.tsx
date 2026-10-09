import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { OccasionsEditor } from "@/components/admin/occasions-editor";
import { OCCASIONS_KEY, toDrafts } from "@/lib/occasions";

// Seasonal store campaigns (P3-07 / WF-08): the Occasions editor. super_admin
// only (the store layout redirects everyone else). Reads store_settings.occasions
// as the signed-in admin; the editor saves through saveOccasions().
export const dynamic = "force-dynamic";

export default async function OccasionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Occasions");

  const supabase = await createClient();
  const { data } = await supabase.from("store_settings").select("value").eq("key", OCCASIONS_KEY).maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-heading">{t("adminPageTitle")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("adminPageIntro")}</p>
      </div>
      <OccasionsEditor locale={locale} initial={toDrafts(data?.value)} />
    </div>
  );
}
