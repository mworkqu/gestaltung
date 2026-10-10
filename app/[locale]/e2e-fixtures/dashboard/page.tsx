import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { StockListsView } from "@/components/admin/stock-lists-view";
import { AdminHomeView } from "@/components/dashboard/admin-home";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";
import type { Interest, StockItem, StockPart } from "@/lib/admin/stock-lists";
import { cn } from "@/lib/utils";

// TEST-ONLY (lib/e2e-fixtures.ts): the super-admin home tiles and the stock
// lists with STATIC sample data (no Supabase, no session), so the e2e suite
// can photograph the owner's dashboard (the real one needs a super_admin
// session, which the read-only suite never creates). ?view=stock shows the
// stock page. 404 everywhere else. Nothing here is real data.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const SUPPLIERS = {
  voltaat: { id: "sample-voltaat", name: "Voltaat", minOrderValue: null },
  digikey: { id: "sample-digikey", name: "DigiKey", minOrderValue: 200 },
};

function part(id: string, name: string, price: number, cost: number | null, supplier: keyof typeof SUPPLIERS | null, own = 0): StockPart {
  return {
    id: `sample-${id}`,
    sku: `SAMPLE-${id.toUpperCase()}`,
    name,
    photo: null,
    price,
    landedCost: cost,
    supplier: supplier ? SUPPLIERS[supplier] : null,
    supplierSku: null,
    supplierUrl: null,
    moq: 1,
    leadTimeClass: "in_stock",
    ownQty: own,
  };
}

const interest = (o: Partial<Interest>): Interest => ({ cartPeople: 0, requestPeople: 0, requestedQty: 0, olderSignals: 0, views: 0, ...o });

const BUY: StockItem[] = [
  { part: part("uno", "Arduino Uno R3 board", 65, 38, "voltaat"), bucket: "buy", interest: interest({ cartPeople: 3, requestPeople: 1, requestedQty: 2, views: 41 }), qty: 5 },
  { part: part("pir", "HC-SR501 PIR motion sensor", 18, 9.5, "voltaat"), bucket: "buy", interest: interest({ cartPeople: 2, views: 23 }), qty: 4 },
  { part: part("oled", "0.96 inch OLED display, I2C", 32, 17, "digikey"), bucket: "buy", interest: interest({ requestPeople: 2, requestedQty: 3, views: 12 }), qty: 3 },
];
const WATCH: StockItem[] = [
  { part: part("dht22", "DHT22 temperature and humidity sensor", 35, 21, "voltaat", 2), bucket: "watch", interest: interest({ views: 17, olderSignals: 1 }), qty: 2 },
  { part: part("servo", "SG90 micro servo", 22, 11, "voltaat"), bucket: "watch", interest: interest({ views: 9 }), qty: 2 },
];
const DONT: StockItem[] = [
  { part: part("relay", "5 V relay module, 1 channel", 15, 7, "voltaat"), bucket: "dont", interest: interest({}), qty: 1 },
  { part: part("buzzer", "Active buzzer 5 V", 6, 2.5, "voltaat"), bucket: "dont", interest: interest({}), qty: 1 },
  { part: part("jumpers", "Jumper wires M-M, 40 pcs", 12, 5, null), bucket: "dont", interest: interest({}), qty: 1 },
];

export default async function DashboardFixturePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  const { view } = await searchParams;
  setRequestLocale(locale);

  if (view === "stock") {
    const t = await getTranslations("AdminStock");
    const isRtl = locale === "ar";
    const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
    return (
      <MessagesScope scope="all">
        <div className="container space-y-6 py-8" data-testid="fixture-dashboard-stock">
          <div className="min-w-0">
            <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
            <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-mutedtext">{t("intro")}</p>
          </div>
          <StockListsView locale={locale} buy={BUY} watch={WATCH} dont={DONT} />
        </div>
      </MessagesScope>
    );
  }

  return (
    <MessagesScope scope="all">
      <div className="container py-8" data-testid="fixture-dashboard-home">
        <AdminHomeView locale={locale} counts={{ reply: 4, confirm: 2, buy: BUY.length, fix: 0 }} />
      </div>
    </MessagesScope>
  );
}
