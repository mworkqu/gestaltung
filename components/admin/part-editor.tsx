"use client";

// Product edit page body (D1 item 5): a sticky "What's missing" line on top,
// then Delivery (supplier offers) as its own section — the only place a
// delivery date comes from — then the product form. The Sourcing panel is
// rendered on the server and passed in as `delivery`.

import { useState } from "react";
import { useTranslations } from "next-intl";

import { MissingSummary, PartForm } from "@/components/parts/part-form";
import type { MissingKey } from "@/lib/admin/part-missing";
import type { Part } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export function PartEditor({
  part,
  returnTo,
  deliveryMissing,
  initialMissing,
  delivery,
}: {
  part: Part;
  returnTo: string | null;
  deliveryMissing: boolean;
  initialMissing: MissingKey[];
  delivery: React.ReactNode;
}) {
  const t = useTranslations("PartEdit");
  // The form reports its own fields; delivery follows the server (it changes
  // when an offer is added in the panel and the page refreshes).
  const [formMissing, setFormMissing] = useState<MissingKey[]>(initialMissing.filter((k) => k !== "delivery"));
  const missing: MissingKey[] = deliveryMissing ? [...formMissing, "delivery"] : formMissing;

  return (
    <div className="mt-6 space-y-6">
      <MissingSummary missing={missing} />

      <section
        id="delivery"
        tabIndex={-1}
        aria-labelledby="delivery-title"
        className={cn("neu p-6 sm:p-8", deliveryMissing && "ring-2 ring-red-400")}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 id="delivery-title" className="text-lg font-extrabold text-heading">
            {t("deliveryTitle")}
          </h2>
          {deliveryMissing && (
            <span className="text-[11px] font-bold uppercase tracking-wide text-red-700">{t("addThis")}</span>
          )}
          {/* HINT: swap for components/ui/hint.tsx (D3) once it lands. */}
          <span
            role="img"
            tabIndex={0}
            aria-label={t("deliveryHint")}
            title={t("deliveryHint")}
            className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-borderstrong text-[11px] font-bold text-mutedtext focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60"
          >
            ?
          </span>
        </div>
        <p className="mb-4 text-xs text-mutedtext">{t("deliveryHint")}</p>
        {delivery}
      </section>

      <div className="neu max-w-2xl p-6 sm:p-8">
        <PartForm
          mode="edit"
          part={part}
          returnTo={returnTo}
          onMissingChange={setFormMissing}
        />
      </div>
    </div>
  );
}
