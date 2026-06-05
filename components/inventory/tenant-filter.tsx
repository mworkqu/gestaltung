"use client";

import { useTranslations, useLocale } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Tenant } from "@/lib/supabase/types";

// super_admin-only filter: narrows the inventory list to one tenant via a
// ?tenant=<id> query param. "All" clears it.
export function TenantFilter({
  tenants,
  selected,
}: {
  tenants: Pick<Tenant, "id" | "name">[];
  selected?: string;
}) {
  const t = useTranslations("Inventory");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const pathname = usePathname();

  function onChange(value: string) {
    router.push(value ? `${pathname}?tenant=${value}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "text-[10px] text-mutedtext",
          isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]"
        )}
      >
        {t("filterTenant")}
      </span>
      <select
        value={selected ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60"
      >
        <option value="">{t("filterAll")}</option>
        {tenants.map((ten) => (
          <option key={ten.id} value={ten.id}>
            {ten.name}
          </option>
        ))}
      </select>
    </div>
  );
}
