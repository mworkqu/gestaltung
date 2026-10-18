import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import type { EngineerServices } from "@/lib/services/quote";
import { saveServicePrices } from "./actions";

// Engineer service prices (0092, store_settings 'engineer_services'). Every
// price the client sees is computed from these; nothing is written in the copy.

const FIELDS: { group: "assembly" | "cad_engineer" | "pcb_gerber"; keys: string[] }[] = [
  { group: "assembly", keys: ["base_qar", "per_component_qar", "per_connection_qar", "days"] },
  { group: "cad_engineer", keys: ["base_qar", "hourly_qar", "base_hours", "days"] },
  { group: "pcb_gerber", keys: ["base_qar", "per_component_qar", "days"] },
];

export async function ServicePricesForm({ locale, prices }: { locale: string; prices: EngineerServices }) {
  const t = await getTranslations("AdminJobs");
  return (
    <section className="neu space-y-4 p-6" data-testid="service-prices">
      <div>
        <h2 className="text-base font-bold text-heading">{t("pricesTitle")}</h2>
        <p className="text-[12px] text-mutedtext">{t("pricesNote")}</p>
      </div>
      <form action={saveServicePrices} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <div className="grid gap-4 lg:grid-cols-3">
          {FIELDS.map(({ group, keys }) => (
            <fieldset key={group} className="tile space-y-2 p-4">
              <legend className="px-1 text-sm font-bold text-heading">{t(`service_${group}`)}</legend>
              {keys.map((k) => (
                <label key={k} className="flex items-center justify-between gap-3 text-xs text-body">
                  <span>{t(`field_${k}`)}</span>
                  <input
                    name={`${group}.${k}`}
                    type="number"
                    step="any"
                    min={0}
                    required
                    defaultValue={String((prices[group] as Record<string, number>)[k])}
                    className="w-24 rounded-lg bg-panel px-2 py-1.5 text-end font-mono text-sm tabular-nums text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
                    dir="ltr"
                  />
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <label className="flex items-center gap-3 text-xs text-body">
          <span>{t("field_round_to_qar")}</span>
          <input
            name="round_to_qar"
            type="number"
            min={1}
            max={100}
            step={1}
            required
            defaultValue={String(prices.round_to_qar)}
            className="w-20 rounded-lg bg-panel px-2 py-1.5 text-end font-mono text-sm tabular-nums text-heading shadow-neu-inset outline-none"
            dir="ltr"
          />
        </label>
        <Button type="submit" size="sm">
          {t("pricesSave")}
        </Button>
      </form>
    </section>
  );
}
