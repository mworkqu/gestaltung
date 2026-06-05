"use client";

import { useTranslations, useLocale } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { JOB_STATUSES } from "@/lib/jobs/constants";

const controlClass =
  "rounded-lg border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60";

// super_admin-only filters: status + client tenant, via ?status= & ?tenant=.
export function JobsFilters({
  tenants,
  selectedStatus,
  selectedTenant,
}: {
  tenants: { id: string; name: string }[];
  selectedStatus?: string;
  selectedTenant?: string;
}) {
  const t = useTranslations("Jobs");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const pathname = usePathname();

  function apply(next: { status?: string; tenant?: string }) {
    const status = next.status ?? selectedStatus ?? "";
    const tenant = next.tenant ?? selectedTenant ?? "";
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (tenant) params.set("tenant", tenant);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "text-[10px] text-mutedtext",
          isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]"
        )}
      >
        {t("filterLabel")}
      </span>
      <select
        value={selectedStatus ?? ""}
        onChange={(e) => apply({ status: e.target.value })}
        className={controlClass}
      >
        <option value="">{t("filterAllStatuses")}</option>
        {JOB_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status_${s}`)}
          </option>
        ))}
      </select>
      <select
        value={selectedTenant ?? ""}
        onChange={(e) => apply({ tenant: e.target.value })}
        className={controlClass}
      >
        <option value="">{t("filterAllTenants")}</option>
        {tenants.map((ten) => (
          <option key={ten.id} value={ten.id}>
            {ten.name}
          </option>
        ))}
      </select>
    </div>
  );
}
