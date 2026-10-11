import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { MessagesScope } from "@/components/i18n/messages-scope";
import { OrdersTable, type OrderListRow } from "@/components/admin/orders-table";
import { OrderStatusPill } from "@/components/admin/order-controls";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";
import type { OrderLine } from "@/lib/admin/order-lines";

// TEST-ONLY (lib/e2e-fixtures.ts): the owner's order list with STATIC sample
// orders (no Supabase, no session) so the e2e suite can check the status hints,
// column hints, WhatsApp column and next-step buttons. The real page needs a
// super_admin session, which the read-only suite never creates. Nothing here
// is real data; the buttons are never clicked.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function order(id: string, status: string, extra: Partial<OrderListRow> = {}): OrderListRow {
  return {
    id,
    profile_id: null,
    customer_name: "Sample Customer",
    customer_phone: "+97466567410",
    customer_email: null,
    delivery_area: "doha",
    delivery_notes: null,
    status: status as OrderListRow["status"],
    total_qar: 120,
    whatsapp_sent: false,
    created_at: "2026-10-09T10:00:00Z",
    updated_at: "2026-10-09T10:00:00Z",
    ...extra,
  };
}

function line(orderId: string, n: number, supplier: { code: string; name: string } | null): OrderLine {
  return {
    id: `${orderId}-l${n}`,
    orderId,
    partId: `p${n}`,
    sku: `SAMPLE-${n}`,
    name: `Sample part ${n}`,
    quantity: 1,
    unitPrice: 20,
    lineTotal: 20,
    photo: null,
    supplier,
    projectId: null,
  };
}

const VOLTAAT = { code: "voltaat", name: "Voltaat" };

const ORDERS: OrderListRow[] = [
  order("aaaa0001-0000-0000-0000-000000000000", "confirmed"),
  order("aaaa0002-0000-0000-0000-000000000000", "paid", { whatsapp_sent: true }),
  order("aaaa0003-0000-0000-0000-000000000000", "sourcing"),
  order("aaaa0004-0000-0000-0000-000000000000", "shipped"),
  order("aaaa0005-0000-0000-0000-000000000000", "delivered"),
  order("aaaa0006-0000-0000-0000-000000000000", "cancelled", { is_test: true }),
];

export default async function OrdersFixturePage({ params }: { params: Promise<{ locale: string }> }) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);

  const lines = new Map<string, OrderLine[]>(ORDERS.map((o) => [o.id, [line(o.id, 1, VOLTAAT), line(o.id, 2, VOLTAAT)]]));

  return (
    <MessagesScope scope="all">
      <div className="container space-y-6 py-8" data-testid="fixture-orders">
        <OrdersTable orders={ORDERS} lines={lines} locale={locale} />
        <p>
          <span data-testid="fixture-lone-pill">
            <OrderStatusPill status="paid" />
          </span>
        </p>
      </div>
    </MessagesScope>
  );
}
