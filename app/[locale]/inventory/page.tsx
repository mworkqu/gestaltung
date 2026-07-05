import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Package, Plus, Pencil } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DeleteItemButton } from "@/components/inventory/delete-item-button";
import { TenantFilter } from "@/components/inventory/tenant-filter";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ItemRow = {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string;
  unit_price: number | null;
  low_stock_threshold: number | null;
  tenants: { name: string } | null;
};

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { locale } = await params;
  const { tenant: tenantFilter } = await searchParams;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  const t = await getTranslations("Inventory");
  const isRtl = locale === "ar";
  const isSuperAdmin = session.profile.role === "super_admin";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();

  // RLS scopes the rows automatically. Embed the tenant name for super_admin.
  let query = supabase
    .from("inventory_items")
    .select(
      "id, tenant_id, sku, name, category, quantity, unit, unit_price, low_stock_threshold, tenants(name)"
    )
    .order("name", { ascending: true });

  if (isSuperAdmin && tenantFilter) {
    query = query.eq("tenant_id", tenantFilter);
  }

  const { data, error } = await query;
  const items = (data ?? []) as unknown as ItemRow[];

  // Tenant list for the super_admin filter (RLS lets super_admin see all).
  let tenants: { id: string; name: string }[] = [];
  if (isSuperAdmin) {
    const { data: tdata } = await supabase
      .from("tenants")
      .select("id, name")
      .order("name", { ascending: true });
    tenants = tdata ?? [];
  }

  const priceFmt = (v: number | null) =>
    v === null ? "—" : `${v.toFixed(2)} ${t("currency")}`;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="mt-2 text-2xl font-extrabold text-heading">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-mutedtext">
            {t("count", { count: items.length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isSuperAdmin && tenants.length > 0 && (
            <TenantFilter tenants={tenants} selected={tenantFilter} />
          )}
          <Button asChild className="rounded-full">
            <Link href="/inventory/new">
              <Plus className="h-4 w-4" />
              {t("addItem")}
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-8 text-sm font-medium text-destructive">
          {t("error_unknown")}
        </p>
      )}

      {/* Empty state */}
      {!error && items.length === 0 && (
        <div className="neu mt-8 flex flex-col items-center gap-4 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
            <Package className="h-7 w-7 text-cobalt" strokeWidth={1.5} />
          </span>
          <div>
            <p className="text-base font-semibold text-heading">
              {t("emptyTitle")}
            </p>
            <p className="mt-1 text-sm text-mutedtext">{t("emptyBody")}</p>
          </div>
          <Button asChild className="rounded-full">
            <Link href="/inventory/new">
              <Plus className="h-4 w-4" />
              {t("addItem")}
            </Link>
          </Button>
        </div>
      )}

      {/* Table */}
      {!error && items.length > 0 && (
        <div className="neu mt-8 overflow-x-auto p-2">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-borderstrong/60 text-start">
                <Th mono={mono}>{t("colName")}</Th>
                <Th mono={mono}>{t("colSku")}</Th>
                {isSuperAdmin && <Th mono={mono}>{t("colTenant")}</Th>}
                <Th mono={mono}>{t("colCategory")}</Th>
                <Th mono={mono} numeric>
                  {t("colQuantity")}
                </Th>
                <Th mono={mono} numeric>
                  {t("colPrice")}
                </Th>
                <Th mono={mono}>
                  <span className="sr-only">{t("colActions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const low =
                  item.low_stock_threshold !== null &&
                  item.quantity <= item.low_stock_threshold;
                return (
                  <tr
                    key={item.id}
                    className="border-b border-borderstrong/40 last:border-0 hover:bg-panel/50"
                  >
                    <td className="px-4 py-3 font-medium text-heading">
                      {item.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-mutedtext">
                      {item.sku}
                    </td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3 text-body">
                        {item.tenants?.name ?? "—"}
                      </td>
                    )}
                    <td className="px-4 py-3 text-body">
                      {item.category ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-body">
                      <span className="inline-flex items-center gap-2">
                        {item.quantity} {item.unit}
                        {low && (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                            {t("lowStock")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-body">
                      {priceFmt(item.unit_price)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label={t("edit")}
                          className="h-8 w-8 text-mutedtext hover:text-cobalt"
                        >
                          <Link href={`/inventory/${item.id}/edit`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <DeleteItemButton id={item.id} name={item.name} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  mono,
  numeric,
}: {
  children: React.ReactNode;
  mono: (extra?: string) => string;
  numeric?: boolean;
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-[10px] font-semibold text-mutedtext",
        numeric ? "text-end" : "text-start",
        mono()
      )}
    >
      {children}
    </th>
  );
}
