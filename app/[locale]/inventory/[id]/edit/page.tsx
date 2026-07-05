import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { ItemForm } from "@/components/inventory/item-form";
import type { InventoryItem } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  const supabase = await createClient();
  // RLS ensures a tenant can only load its own item; others get no row.
  const { data: item } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("id", id)
    .single<InventoryItem>();

  if (!item) notFound();

  const t = await getTranslations("Inventory");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <div className="mx-auto max-w-2xl">
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">
        {t("editTitle")}
      </h1>
      <div className="neu mt-8 p-6 sm:p-8">
        <ItemForm mode="edit" item={item} />
      </div>
    </div>
  );
}
