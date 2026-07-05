"use client";

import { useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Check } from "lucide-react";

import { toggleWhatsappSent } from "@/app/[locale]/dashboard/store/orders/actions";
import { cn } from "@/lib/utils";

// Checkbox-style toggle for the "WhatsApp sent" flag on an order.
export function WhatsappSentToggle({
  id,
  sent,
}: {
  id: string;
  sent: boolean;
}) {
  const t = useTranslations("PartsDashboard");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  function toggle() {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("locale", locale);
    formData.set("whatsapp_sent", String(!sent));
    startTransition(() => toggleWhatsappSent(formData));
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      disabled={pending}
      aria-pressed={sent}
      aria-label={t("whatsappSent")}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:opacity-50",
        sent
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
          : "border-borderstrong bg-panel text-transparent hover:border-cobalt"
      )}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  );
}
