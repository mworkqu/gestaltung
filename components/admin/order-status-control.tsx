"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { nextStatuses, normaliseOrderStatus } from "@/lib/orders/status";
import { setOrderStatus, type OrderStatusState } from "@/app/[locale]/dashboard/store/orders/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Admin order page (P2-01): pick the next status, add an optional note (the
// customer sees it on their order page and in the status email), Save. Only
// the allowed next statuses are offered; delivered and cancelled are final.
export function OrderStatusControl({ id, status }: { id: string; status: string }) {
  const t = useTranslations("PartsDashboard");
  const locale = useLocale();
  const current = normaliseOrderStatus(status) ?? "confirmed";
  const options = nextStatuses(current);
  const [state, action, pending] = useActionState<OrderStatusState, FormData>(setOrderStatus, null);

  if (!options.length) {
    return (
      <p className="text-sm text-mutedtext">{t("statusFinal", { status: t(`order_status_${current}`) })}</p>
    );
  }

  const field =
    "w-full rounded-lg border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60";

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="locale" value={locale} />
      <label className="block space-y-1">
        <span className="text-[11px] text-mutedtext">{t("statusNext")}</span>
        <select name="status" defaultValue={options[0]} className={cn(field, locale === "ar" && "text-right")}>
          {options.map((s) => (
            <option key={s} value={s}>
              {t(`order_status_${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-mutedtext">{t("statusNote")}</span>
        <textarea name="note" rows={3} maxLength={1000} className={field} />
      </label>
      <Button type="submit" disabled={pending} className="w-full rounded-full">
        {pending ? t("statusSaving") : t("statusSave")}
      </Button>
      {state?.ok && (
        <p role="status" className="text-sm text-buy">
          {t("statusSaved", { status: t(`order_status_${state.status}`) })}
        </p>
      )}
      {state && !state.ok && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(`statusErr_${state.error}`)}
        </p>
      )}
    </form>
  );
}
