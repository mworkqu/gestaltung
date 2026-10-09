"use client";

import { useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";

import { nextStatuses, normaliseOrderStatus } from "@/lib/orders/status";
import { updateOrderStatus } from "@/app/[locale]/dashboard/store/orders/actions";
import { cn } from "@/lib/utils";

// Inline status dropdown on the orders list; changing it posts to the server
// action immediately (no note — the order page has the note form). Offers the
// current status plus the allowed next ones only (lib/orders/status.ts).
export function OrderStatusSelect({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const t = useTranslations("PartsDashboard");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const [pending, startTransition] = useTransition();
  const current = normaliseOrderStatus(status) ?? "confirmed";
  const options = [current, ...nextStatuses(current)];

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === current) return;
    const formData = new FormData();
    formData.set("id", id);
    formData.set("locale", locale);
    formData.set("status", e.target.value);
    startTransition(() => updateOrderStatus(formData));
  }

  return (
    <select
      value={current}
      onChange={onChange}
      disabled={pending || options.length === 1}
      onClick={(e) => e.stopPropagation()}
      aria-label={t("colStatus")}
      className={cn(
        "rounded-lg border border-white/60 bg-panel px-2 py-1 text-xs text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60 disabled:opacity-50",
        isRtl && "text-right"
      )}
    >
      {options.map((s) => (
        <option key={s} value={s}>
          {t(`order_status_${s}`)}
        </option>
      ))}
    </select>
  );
}
