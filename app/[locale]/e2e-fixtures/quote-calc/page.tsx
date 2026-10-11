import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { QuoteAccuracySection } from "@/components/admin/quote-accuracy";
import { QuoteCalcCard } from "@/components/admin/quote-calc-card";
import { QuoteForm } from "@/components/admin/quote-form";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";
import { getPart } from "@/lib/studio/library";
import { quoteAccuracy } from "@/lib/studio/quote-accuracy";
import { DEFAULT_QUOTE_RULE, quoteBreakdown, quoteCalcSnapshot } from "@/lib/studio/request-summary";
import { emptyStudioDoc, type MechPart, type StudioDoc } from "@/lib/studio/schema";

import { fixtureSaveQuote, fixtureSaveRule } from "./actions";

// TEST-ONLY (lib/e2e-fixtures.ts): the W2b admin "How we calculated" card, the
// "Your quote (QAR)" form and the "Quote accuracy" section with STATIC sample
// data (no Supabase, no session; the real page needs a super_admin session).
// Save buttons call no-write fixture actions. ?migrated=0 shows the
// "Run migration 0073 first" state. 404 everywhere else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const SAMPLE_SKU = "SAMPLE-ESP32";

function sampleDoc(): StudioDoc {
  const base = emptyStudioDoc({ ...emptyStudioDoc().spec, name: "Desk buddy" });
  const mech: MechPart[] = [
    { id: "lid", template: "lid", params: {}, printable: { material: "PLA", estGrams: 20 } },
    { id: "base", template: "base", params: {}, printable: { material: "PLA", estGrams: 30 } },
    { id: "s1", template: "standoff", params: {}, printable: { material: "PLA", estGrams: 1 } },
    { id: "s2", template: "standoff", params: {}, printable: { material: "PLA", estGrams: 1 } },
  ];
  return {
    ...base,
    components: [
      { partId: "esp32_devkit", instanceId: "esp32_devkit_1", label: "ESP32" },
      { partId: "led_5mm", instanceId: "led_5mm_1", label: "LED" },
    ],
    mech,
  };
}

export default async function QuoteCalcFixturePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ migrated?: string }>;
}) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  const { migrated } = await searchParams;
  setRequestLocale(locale);

  // ESP32 linked to a sample store product at QAR 45; the LED is "we source".
  const lookup = (id: string) => {
    const p = getPart(id);
    return p && id === "esp32_devkit" ? { ...p, storeSkus: [SAMPLE_SKU] } : p;
  };
  const b = quoteBreakdown({ doc: sampleDoc(), getPart: lookup, prices: new Map([[SAMPLE_SKU, 45]]), rule: DEFAULT_QUOTE_RULE });
  const calc = quoteCalcSnapshot(b, {
    ruleSource: "settings",
    projectId: null,
    projectLink: `/${locale}/e2e-fixtures/studio`,
    now: new Date("2026-10-11T08:00:00.000Z"),
  });
  // Three sample quotes, all above the middle of their range.
  const accuracy = quoteAccuracy(
    [280, 290, 270].map((finalQar) => ({ finalQar, calc })),
    DEFAULT_QUOTE_RULE,
  );
  const isMigrated = migrated !== "0";

  return (
    <MessagesScope scope="all">
      <div className="container max-w-4xl space-y-6 py-8" data-testid="fixture-quote-calc">
        {isMigrated ? (
          <>
            <QuoteCalcCard calc={calc} locale={locale} />
            <QuoteForm leadId="00000000-0000-4000-8000-000000000000" locale={locale} midpoint={calc.midpoint} initialFinal={null} initialNote={null} action={fixtureSaveQuote} />
          </>
        ) : null}
        <QuoteAccuracySection
          locale={locale}
          accuracy={isMigrated ? accuracy : quoteAccuracy([], DEFAULT_QUOTE_RULE)}
          rule={DEFAULT_QUOTE_RULE}
          ruleSource="settings"
          migrated={isMigrated}
          action={fixtureSaveRule}
        />
      </div>
    </MessagesScope>
  );
}
