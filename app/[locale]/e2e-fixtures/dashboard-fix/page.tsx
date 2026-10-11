import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { FixList, type FixListRow, type FixSupplier } from "@/components/admin/fix-list";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";

// TEST-ONLY (lib/e2e-fixtures.ts): the D1 Fix list with STATIC sample rows
// (no Supabase, no session) so e2e/dashboard-fix.spec.ts can check grouping,
// selection, the bulk bar and the drawer. The spec never confirms a bulk
// action or saves the drawer. 404 everywhere else. Nothing here is real data.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ROWS: FixListRow[] = [
  {
    id: id(1),
    name: "Arduino Uno R3 board",
    sku: "VLT-1",
    issues: ["delivery"],
    bucket: "voltaat",
    why: { code: "offerOff", supplier: "Voltaat" },
    imageUrl: "https://cdn.example/uno.jpg",
    price: 65,
  },
  {
    id: id(2),
    name: "HC-SR501 PIR motion sensor",
    sku: "VLT-2",
    issues: ["photo", "delivery"],
    bucket: "voltaat",
    why: { code: "outOfStock", supplier: "Voltaat" },
    imageUrl: null,
    price: 18,
  },
  {
    id: id(3),
    name: "Hex nut M3",
    sku: "DK-3",
    issues: ["delivery"],
    bucket: "digikey",
    why: { code: "noLeadTime", supplier: "DigiKey" },
    imageUrl: "https://cdn.example/nut.jpg",
    price: 1,
  },
  {
    id: id(4),
    name: "Jumper wires M-M, 40 pcs",
    sku: "GR-004",
    issues: ["supplier", "delivery"],
    bucket: "none",
    why: { code: "noOffer", supplier: null },
    imageUrl: "https://cdn.example/jumpers.jpg",
    price: 12,
  },
  {
    id: id(5),
    name: "Active buzzer 5 V",
    sku: "GR-005",
    issues: ["price"],
    bucket: "none",
    why: null,
    imageUrl: "https://cdn.example/buzzer.jpg",
    price: 0,
  },
];

const SUPPLIERS: FixSupplier[] = [
  { id: id(101), name: "DigiKey" },
  { id: id(102), name: "Mouser" },
  { id: id(103), name: "Voltaat" },
];

export default async function DashboardFixFixturePage({ params }: { params: Promise<{ locale: string }> }) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("FixList");
  return (
    <MessagesScope scope="all">
      <div className="container space-y-6 py-8" data-testid="fixture-dashboard-fix">
        <h1 className="text-2xl font-extrabold text-heading">{t("title")}</h1>
        <FixList locale={locale} initialRows={ROWS} suppliers={SUPPLIERS} />
      </div>
    </MessagesScope>
  );
}
