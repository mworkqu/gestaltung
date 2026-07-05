"use client";

import { useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";

import type { PartOrderStatus } from "@/lib/supabase/types";
import { PART_ORDER_STATUSES } from "@/lib/parts/constants";
import { updateOrderStatus } from "@/app/[locale]/dashboard/store/orders/actions";
import { cn } from "@/lib/utils";

// Inline status dropdown; changing it posts to the server action immediately.
export function OrderStatusSelect({
  id,
  status,
}: {
  id: string;
  status: PartOrderStatus;
}) {
  const t = useTranslations("PartsDashboard");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("locale", locale);
    formData.set("status", e.target.value);
    startTransition(() => updateOrderStatus(formData));
  }

  return (
    <select
      value={status}
      onChange={onChange}
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "rounded-lg border border-white/60 bg-panel px-2 py-1 text-xs text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60 disabled:opacity-50",
        isRtl && "text-right"
      )}
    >
      {PART_ORDER_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(`order_status_${s}`)}
        </option>
      ))}
    </select>
  );
}
