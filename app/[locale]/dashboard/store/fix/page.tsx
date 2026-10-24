import { getTranslations, setRequestLocale } from "next-intl/server";

import { FixList, type FixListRow, type FixSupplier } from "@/components/admin/fix-list";
import { loadFixParts } from "@/lib/admin/fix-data";
import { OWN_STOCK_SUPPLIER_CODE } from "@/lib/admin/fix-groups";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { requireSuperAdmin } from "@/lib/auth/guards";

// The Fix tile's target (D1): published products missing a photo, price,
// supplier or delivery date, grouped by reason and supplier, with bulk fixes
// and a drawer to fix one in place. super_admin only (store layout + RLS).
// The Home tile counts the same loadFixParts() rows, so the numbers match.

export const dynamic = "force-dynamic";

export default async function FixPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  setRequestLocale(locale);
  const t = await getTranslations("FixList");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const db = await createClient();
  const [items, suppliersRes] = await Promise.all([
    loadFixParts(db),
    db.from("suppliers").select("id, code, name, active").eq("active", true).order("name"),
  ]);

  const rows: FixListRow[] | null = items
    ? items.map(({ part, issues, bucket, why }) => ({
        id: part.id,
        name: part.name,
        sku: part.sku ?? null,
        issues,
        bucket,
        why,
        imageUrl: typeof part.image_url === "string" ? part.image_url : null,
        price: part.unit_price === null || part.unit_price === undefined ? null : Number(part.unit_price),
      }))
    : null;
  const suppliers: FixSupplier[] = ((suppliersRes.data ?? []) as { id: string; code: string; name: string }[])
    .filter((s) => s.code !== OWN_STOCK_SUPPLIER_CODE)
    .map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-mutedtext">{t("intro")}</p>
      </div>
      {rows === null || suppliersRes.error ? (
        <p className="neu p-6 text-sm text-mutedtext">{t("loadError")}</p>
      ) : (
        <FixList locale={locale} initialRows={rows} suppliers={suppliers} />
      )}
    </div>
  );
}
