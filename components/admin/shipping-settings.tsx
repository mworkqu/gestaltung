"use client";

// Shipping tiers at checkout (Task 18f): real carrier cost and transit days
// per tier, the handling fee (shown to the customer as its own line), our
// handling days and the promise buffer.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";

import { saveShippingSettings, type ShippingSettings } from "@/app/[locale]/dashboard/store/sourcing/actions";
import { SHIPPING_TIERS } from "@/lib/store/delivery";
import { cn } from "@/lib/utils";

type Tier = ShippingSettings["tiers"][keyof ShippingSettings["tiers"]];

// What the inputs hold while typing: strings. Converted to numbers when saved.
type Draft = {
  handling_fee_qar: string;
  handling_days: string;
  buffer_days: string;
  tiers: Record<keyof ShippingSettings["tiers"], Record<keyof Tier, string>>;
};

const toDraft = (v: ShippingSettings): Draft => ({
  handling_fee_qar: String(v.handling_fee_qar),
  handling_days: String(v.handling_days),
  buffer_days: String(v.buffer_days),
  tiers: Object.fromEntries(
    SHIPPING_TIERS.map((k) => [k, { carrier_cost_qar: String(v.tiers[k].carrier_cost_qar), transit_days: String(v.tiers[k].transit_days) }]),
  ) as Draft["tiers"],
});

// The action coerces with Number() and clamps, so converting here sends the same values.
const fromDraft = (d: Draft): ShippingSettings => ({
  handling_fee_qar: Number(d.handling_fee_qar),
  handling_days: Number(d.handling_days),
  buffer_days: Number(d.buffer_days),
  tiers: Object.fromEntries(
    SHIPPING_TIERS.map((k) => [k, { carrier_cost_qar: Number(d.tiers[k].carrier_cost_qar), transit_days: Number(d.tiers[k].transit_days) }]),
  ) as ShippingSettings["tiers"],
});

const input =
  "w-24 rounded-lg border border-white/60 bg-surface px-2 py-1 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

export function ShippingSettingsEditor({ locale, initial }: { locale: string; initial: ShippingSettings }) {
  const t = useTranslations("Delivery");
  const router = useRouter();
  const [s, setS] = useState<Draft>(() => toDraft(initial));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const top = (k: "handling_fee_qar" | "handling_days" | "buffer_days") => (
    <label className="flex items-center justify-between gap-3 text-sm text-body">
      {t(`s_${k}`)}
      <input value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} inputMode="decimal" className={input} dir="ltr" />
    </label>
  );

  return (
    <div className="neu space-y-5 p-6">
      <div>
        <h2 className="text-lg font-bold text-heading">{t("settingsTitle")}</h2>
        <p className="mt-1 text-xs text-mutedtext">{t("settingsHelp")}</p>
      </div>
      <div className="grid gap-3 sm:max-w-sm">
        {top("handling_fee_qar")}
        {top("handling_days")}
        {top("buffer_days")}
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-mutedtext">
              <th className="px-2 py-1 text-start" />
              <th className="px-2 py-1 text-start">{t("s_carrier_cost_qar")}</th>
              <th className="px-2 py-1 text-start">{t("s_transit_days")}</th>
            </tr>
          </thead>
          <tbody>
            {SHIPPING_TIERS.map((k) => (
              <tr key={k}>
                <td className="px-2 py-1 font-semibold text-heading">{t(`tier_${k}`)}</td>
                {(["carrier_cost_qar", "transit_days"] as const).map((f) => (
                  <td key={f} className="px-2 py-1">
                    <input
                      value={s.tiers[k][f]}
                      onChange={(e) => setS({ ...s, tiers: { ...s.tiers, [k]: { ...s.tiers[k], [f]: e.target.value } } })}
                      inputMode="decimal"
                      className={input}
                      dir="ltr"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveShippingSettings(locale, fromDraft(s));
              setMsg(r.error ?? t("saved"));
              if (!r.error) router.refresh();
            })
          }
          className={cn("inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50")}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("save")}
        </button>
        {msg && <span className="text-sm text-mutedtext">{msg}</span>}
      </div>
    </div>
  );
}
