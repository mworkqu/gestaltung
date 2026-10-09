import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { formatQar } from "@/lib/pricing/plans";
import { arabicCountForm } from "@/lib/text/count";
import {
  buildDiscountReport,
  parseDiscountSettings,
  windowStartIso,
  type CreditGrantRow,
  type DiscountOrderRow,
  type MonthRow,
} from "@/lib/admin/discount-report";

// Discount-leakage report (P4-07 / WF-27): QAR given away per Qatar calendar
// month by kit discounts, credit redemptions, manual credit grants and waived
// delivery, next to goods revenue. Read-only over existing tables; the store
// layout restricts everything under /dashboard/store to super_admin and RLS
// lets a super admin read part_orders, credits_ledger and store_settings.
// force-dynamic is inherited from the dashboard layout.

const SETTING_KEYS = ["pricing_plans", "free_shipping_threshold", "shipping"] as const;

export default async function DiscountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Discounts");
  const isAr = locale === "ar";
  const db = await createClient();

  const now = new Date();
  const since = windowStartIso(now);

  const [settingsRes, ordersRes, grantsRes] = await Promise.all([
    db.from("store_settings").select("key, value").in("key", [...SETTING_KEYS]),
    fetchAllRows<DiscountOrderRow>((from, to) =>
      db
        .from("part_orders")
        .select(
          "created_at, status, is_test, discount_qar, credit_discount_qar, shipping_qar, handling_fee_qar, total_qar, shipping_tier, split_shipments"
        )
        .gte("created_at", since)
        .neq("status", "cancelled")
        .not("is_test", "is", true)
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<CreditGrantRow>((from, to) =>
      db
        .from("credits_ledger")
        .select("created_at, delta, reason")
        .eq("reason", "admin_grant")
        .gt("delta", 0)
        .gte("created_at", since)
        .order("id")
        .range(from, to)
    ),
  ]);

  const value = (key: string): unknown => (settingsRes.data ?? []).find((r) => r.key === key)?.value;
  const settings = parseDiscountSettings({
    pricingPlans: value("pricing_plans"),
    freeShipping: value("free_shipping_threshold"),
    shipping: value("shipping"),
  });

  const report = buildDiscountReport({
    orders: ordersRes.rows,
    grants: grantsRes.rows,
    settings,
    now,
  });

  const currency = t("currency");
  const num = (n: number) => formatQar(n);
  const money = (n: number) => (isAr ? `${num(n)} ${currency}` : `${currency} ${num(n)}`);
  const pct = (n: number | null) =>
    n === null ? t("noShare") : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n)}%`;
  const monthFmt = new Intl.DateTimeFormat(isAr ? "ar-QA-u-nu-latn" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const monthLabel = (m: MonthRow) => monthFmt.format(new Date(Date.UTC(m.year, m.month - 1, 15)));
  const credits = (n: number) => t("grantedCount", { count: String(n), form: arabicCountForm(n) });

  const hasAny = report.months.some((m) => m.totalQar > 0 || m.goodsRevenueQar > 0);
  const th = "px-4 py-3 text-start text-xs font-semibold text-mutedtext";
  const thNum = "px-4 py-3 text-end text-xs font-semibold text-mutedtext";
  const tdNum = "px-4 py-3 text-end tabular-nums text-body";

  const notes = [
    t("noteKit"),
    t("noteCredit"),
    t("noteGrants", { value: money(report.creditQar) }),
    t("noteFree"),
    t("noteTotal"),
    t("noteGoods"),
    t("noteShare"),
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="kicker text-azure">{t("kicker")}</p>
        <h1 className="title-page mt-2">{t("title")}</h1>
        <p className="mt-3 max-w-[70ch] text-sm text-mutedtext">{t("intro")}</p>
        <p className="mt-1 text-xs text-faint">{t("amountsIn", { currency })}</p>
      </div>

      {ordersRes.error && <p className="text-sm font-medium text-destructive">{t("errorOrders")}</p>}
      {!ordersRes.error && grantsRes.error && (
        <p className="text-sm font-medium text-destructive">{t("errorGrants")}</p>
      )}

      {!ordersRes.error && (
        <div className="neu overflow-x-auto p-2">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-borderstrong/60">
                <th className={th}>{t("colMonth")}</th>
                <th className={thNum}>{t("colKit")}</th>
                <th className={thNum}>{t("colCredit")}</th>
                <th className={thNum}>{t("colGrants")}</th>
                <th className={thNum}>{t("colFree")}</th>
                <th className={thNum}>{t("colTotal")}</th>
                <th className={thNum}>{t("colGoods")}</th>
                <th className={thNum}>{t("colShare")}</th>
              </tr>
            </thead>
            <tbody>
              {report.months.map((m) => (
                <tr key={m.key} className="border-b border-borderstrong/40 hover:bg-panel/50">
                  <td className="px-4 py-3 font-medium text-heading">
                    {monthLabel(m)}
                    {m.current && <span className="ms-2 text-xs font-normal text-mutedtext">({t("soFar")})</span>}
                  </td>
                  <td className={tdNum}>{num(m.kitQar)}</td>
                  <td className={tdNum}>{num(m.creditRedeemedQar)}</td>
                  <td className={tdNum}>
                    {num(m.grantQar)}
                    {m.grantedCredits > 0 && <span className="block text-xs text-faint">{credits(m.grantedCredits)}</span>}
                  </td>
                  <td className={tdNum}>{num(m.freeDeliveryQar)}</td>
                  <td className="px-4 py-3 text-end font-semibold tabular-nums text-heading">{num(m.totalQar)}</td>
                  <td className={tdNum}>{num(m.goodsRevenueQar)}</td>
                  <td className={tdNum}>{pct(m.sharePct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-panel/60 font-semibold text-heading">
                <td className="px-4 py-3">{t("totalRow")}</td>
                <td className="px-4 py-3 text-end tabular-nums">{num(report.totals.kitQar)}</td>
                <td className="px-4 py-3 text-end tabular-nums">{num(report.totals.creditRedeemedQar)}</td>
                <td className="px-4 py-3 text-end tabular-nums">
                  {num(report.totals.grantQar)}
                  {report.totals.grantedCredits > 0 && (
                    <span className="block text-xs font-normal text-faint">{credits(report.totals.grantedCredits)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-end tabular-nums">{num(report.totals.freeDeliveryQar)}</td>
                <td className="px-4 py-3 text-end tabular-nums">{num(report.totals.totalQar)}</td>
                <td className="px-4 py-3 text-end tabular-nums">{num(report.totals.goodsRevenueQar)}</td>
                <td className="px-4 py-3 text-end tabular-nums">{pct(report.totals.sharePct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!ordersRes.error && !hasAny && <p className="text-sm text-mutedtext">{t("empty")}</p>}

      <div className="tile">
        <h2 className="title-card">{t("noteHeading")}</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-mutedtext">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
