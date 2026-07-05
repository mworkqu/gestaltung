import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { ItemForm } from "@/components/inventory/item-form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NewItemPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  const t = await getTranslations("Inventory");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  // super_admin needs the tenant picker; everyone else is locked to their own.
  let tenants: { id: string; name: string }[] | undefined;
  if (session.profile.role === "super_admin") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("tenants")
      .select("id, name")
      .order("name", { ascending: true });
    tenants = data ?? [];
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">
        {t("newTitle")}
      </h1>
      <div className="neu mt-8 p-6 sm:p-8">
        <ItemForm mode="create" tenants={tenants} />
      </div>
    </div>
  );
}
