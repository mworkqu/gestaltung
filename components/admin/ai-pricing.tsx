"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";

import { saveAiPricing } from "@/app/[locale]/dashboard/usage/actions";

// Price per AI call and the charging switch (owner, 2026-09-28). While charging
// is off, clients see the price and "free during launch".
export function AiPricing({ locale, perCall, charging }: { locale: string; perCall: number; charging: boolean }) {
  const t = useTranslations("Payment");
  const [price, setPrice] = useState(String(perCall));
  const [on, setOn] = useState(charging);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="neu flex flex-wrap items-end gap-4 p-5">
      <div className="w-full">
        <p className="text-base font-bold text-heading">{t("adminTitle")}</p>
        <p className="mt-1 text-xs text-mutedtext">{t("adminHelp")}</p>
      </div>
      <label className="block space-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("adminPrice")}</span>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          dir="ltr"
          className="w-24 rounded-lg border border-white/60 bg-surface px-2 py-1 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
        />
      </label>
      <label className="flex items-center gap-2 pb-1.5 text-sm text-body">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        {t("adminCharging")}
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveAiPricing(locale, Number(price), on);
            setMsg(r.error ?? t("adminSaved"));
          })
        }
        className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("adminSave")}
      </button>
      {msg && <span className="pb-1.5 text-sm text-mutedtext">{msg}</span>}
    </div>
  );
}
