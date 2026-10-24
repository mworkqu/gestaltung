import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { RequestReceived } from "@/components/studio/RequestReceived";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";
import { defaultMechParts, layoutBounds, mechSummary } from "@/lib/studio/ai/mech-default";
import { defaultEnclosureFor } from "@/lib/studio/enclosure/templates";
import { getPart } from "@/lib/studio/library";
import { REQUEST_SENT_KEY, requestSummary } from "@/lib/studio/request-summary";
import { clampSpec, emptyStudioDoc, type StudioDoc } from "@/lib/studio/schema";
import { asLocale } from "@/lib/locale";

// TEST-ONLY (lib/e2e-fixtures.ts): the W2 "Request received" page for the
// Studio fixture's "Get it made" (the mock has no project row). A canned doc
// shaped like the fixture's "Desk buddy", rendered by the SAME component as
// /[locale]/projects/[id]/request. No Supabase, no session. 404 everywhere else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function fixtureDoc(locale: "en" | "ar"): StudioDoc {
  const spec = clampSpec({
    name: locale === "ar" ? "رفيق المكتب" : "Desk buddy",
    oneLine: locale === "ar" ? "رفيق صغير للمكتب يضيء عندما أدخل" : "A little desk friend that lights up when I walk in",
    use: "desk",
    power: "usb",
    environment: "indoor",
    features: [],
    inputs: [],
    outputs: ["screen", "led"],
    sizeHint: "palm",
    style: "rounded",
    quantity: 1,
  });
  const ids = ["esp32_devkit", "pir_hcsr501", "oled_096_i2c", "led_5mm"].filter((id) => getPart(id));
  const base: StudioDoc = {
    ...emptyStudioDoc(spec),
    components: ids.map((id) => ({ partId: id, instanceId: `${id}_1`, label: getPart(id)!.name[locale] })),
    enclosure: defaultEnclosureFor(spec),
    answers: { [REQUEST_SENT_KEY]: "2026-10-11T08:00:00.000Z" },
  };
  // The same printed parts the mock's Print step gives (lib/studio/client/mock.ts).
  const enclosure = layoutBounds(base.components, base.layout, getPart) ?? { w: 60, d: 40, h: 25 };
  const summary = mechSummary({ components: base.components, layout: base.layout, getPart, enclosure, template: base.enclosure?.template });
  return { ...base, mech: defaultMechParts(summary) };
}

export default async function StudioRequestFixturePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ quoted?: string }>;
}) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  // W2b: ?quoted=1 = the owner already saved a quote (sample numbers).
  const { quoted } = await searchParams;
  const ownerQuote =
    quoted === "1" ? { finalQar: 450, note: locale === "ar" ? "يشمل الطلاء الأسود المطفي." : "Includes the matte black finish." } : null;
  setRequestLocale(locale);
  const lang = asLocale(locale);
  const summary = requestSummary({
    doc: fixtureDoc(lang),
    projectName: "Desk buddy",
    getPart,
    locale: lang,
    prices: new Map(),
  });
  return (
    <div className="container max-w-4xl py-6 sm:py-10">
      <RequestReceived summary={summary} locale={locale} designHref="/e2e-fixtures/studio" ownerQuote={ownerQuote} />
    </div>
  );
}
