import { stripLinksAndIds } from "@/lib/admin/lead-parse";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  FolderKanban,
  Inbox,
  PackageSearch,
  ShoppingBag,
  Hand,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/parts/format";
import { conversionPct } from "@/lib/pricing/experiment";
import { cn } from "@/lib/utils";
import { intlTag, asLocale } from "@/lib/locale";
import { loadOverviewData } from "@/lib/admin/overview-data";

// "Today" — the owner's first screen (owner, 2026-09-29: the dashboard was
// confusing; audit #41). Only what needs doing, each with a count and a link:
// new messages, open orders, product requests, parts customers need that we
// don't sell, active projects, products without a delivery date. Then the
// latest messages and orders. Test rows (is_test) are left out.
// D2 (2026-10-11): rendered as the top section of the dashboard Home
// (`embedded` = without its own page heading); /dashboard/overview redirects there.
export async function AdminOverview({ locale, embedded = false }: { locale: string; embedded?: boolean }) {
  const t = await getTranslations("Admin");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const {
    newLeads,
    openOrders,
    requests,
    gaps,
    activeProjects,
    onRequest,
    leads,
    orders,
    fProjects,
    fBoms,
    fCircuits,
    fCad,
    fOrders,
    fKitOrders,
    fDelivered,
    fSpends,
    fRedemptions,
    priceCohorts,
    pluginFunnel,
    meetingFunnel,
  } = await loadOverviewData(await createClient());

  const funnel: { key: string; value: number }[] = [
    { key: "funnelProjects", value: fProjects },
    { key: "funnelBoms", value: fBoms },
    { key: "funnelCircuits", value: fCircuits },
    { key: "funnelCad", value: fCad },
    { key: "funnelOrders", value: fOrders },
    { key: "funnelKitOrders", value: fKitOrders },
    { key: "funnelDelivered", value: fDelivered },
    { key: "funnelSpends", value: fSpends },
    { key: "funnelRedemptions", value: fRedemptions },
    ...(pluginFunnel
      ? [
          { key: "funnelPluginSent", value: pluginFunnel.sent },
          { key: "funnelPluginClaimed", value: pluginFunnel.claimed },
          { key: "funnelPluginOrdered", value: pluginFunnel.ordered },
        ]
      : []),
    ...(meetingFunnel
      ? [
          { key: "funnelMeetingsBooked", value: meetingFunnel.booked },
          { key: "funnelMeetingsDone", value: meetingFunnel.done },
          { key: "funnelMeetingsInvoiced", value: meetingFunnel.invoiced },
          { key: "funnelMeetingsPaid", value: meetingFunnel.paid },
        ]
      : []),
  ];

  const cards: { icon: LucideIcon; key: string; value: number; href: string; urgent: boolean }[] = [
    { icon: Inbox, key: "newLeads", value: newLeads, href: "/dashboard/leads", urgent: newLeads > 0 },
    { icon: Truck, key: "openOrders", value: openOrders, href: "/dashboard/store/orders", urgent: openOrders > 0 },
    { icon: Hand, key: "itemRequests", value: requests, href: "/dashboard/store/restock", urgent: requests > 0 },
    { icon: PackageSearch, key: "partsNeeded", value: gaps, href: "/dashboard/store/gaps", urgent: false },
    { icon: FolderKanban, key: "activeProjects", value: activeProjects, href: "/dashboard/projects", urgent: false },
    { icon: ShoppingBag, key: "onRequest", value: onRequest, href: "/dashboard/store/suppliers", urgent: false },
  ];

  const when = (iso: string) =>
    new Intl.DateTimeFormat(intlTag(asLocale(locale)), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso)
    );

  return (
    <div className="space-y-8">
      {!embedded && (
        <div>
          <p className={mono("text-[10px] text-azure")}>{t("todayKicker")}</p>
          <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("todayTitle")}</h1>
          <p className="mt-1 text-sm text-mutedtext">{t("todayIntro")}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.key} href={c.href} className="neu group flex items-start gap-4 p-5 transition-shadow hover:ring-2 hover:ring-cobalt/30">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel shadow-neu-sm",
                c.urgent ? "text-amber-600" : "text-cobalt"
              )}
            >
              <c.icon className="h-5 w-5" strokeWidth={1.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className={cn("text-3xl font-extrabold tabular-nums", c.urgent ? "text-amber-700" : "text-heading")}>{c.value}</span>
                <span className="text-sm font-semibold text-heading">{t(`${c.key}Title`)}</span>
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-mutedtext">{t(`${c.key}Help`)}</span>
            </span>
            <ArrowRight className={cn("mt-1 h-4 w-4 shrink-0 text-faint group-hover:text-cobalt", isRtl && "rotate-180")} />
          </Link>
        ))}
      </div>

      <section className="neu p-6">
        <h2 className="text-sm font-bold text-heading">{t("funnelTitle")}</h2>
        <p className="mt-1 text-xs text-mutedtext">{t("funnelNote")}</p>
        <div className="overflow-x-auto">
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className={mono("text-[10px] text-mutedtext")}>
                <th scope="col" className="pb-2 text-start font-semibold">
                  {t("funnelStep")}
                </th>
                <th scope="col" className="pb-2 text-end font-semibold">
                  {t("funnelCount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {funnel.map((f) => (
                <tr key={f.key} className="border-t border-borderstrong/40">
                  <td className="py-2 text-body">{t(f.key)}</td>
                  <td className="py-2 text-end font-semibold tabular-nums text-heading">{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {priceCohorts.length > 0 && (
          <div className="mt-6 border-t border-borderstrong/40 pt-4">
            <h3 className="text-sm font-bold text-heading">{t("priceExpTitle")}</h3>
            <div className="overflow-x-auto">
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className={mono("text-[10px] text-mutedtext")}>
                    <th scope="col" className="pb-2 text-start font-semibold">
                      {t("priceExpCohort")}
                    </th>
                    <th scope="col" className="pb-2 text-end font-semibold">
                      {t("priceExpUsers")}
                    </th>
                    <th scope="col" className="pb-2 text-end font-semibold">
                      {t("priceExpProject")}
                    </th>
                    <th scope="col" className="pb-2 text-end font-semibold">
                      {t("priceExpCredits")}
                    </th>
                    <th scope="col" className="pb-2 text-end font-semibold">
                      {t("priceExpOrder")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {priceCohorts.map((c) => (
                    <tr key={c.cohort} className="border-t border-borderstrong/40">
                      <td className="py-2 text-start font-semibold text-heading">
                        <bdi>{c.cohort}</bdi>
                      </td>
                      <td className="py-2 text-end font-semibold tabular-nums text-heading">{c.users}</td>
                      <td className="py-2 text-end tabular-nums text-body">{c.withProject}</td>
                      <td className="py-2 text-end tabular-nums text-body">
                        {c.boughtCredits}
                        <span className="ms-1 text-xs text-mutedtext">({conversionPct(c.boughtCredits, c.users)})</span>
                      </td>
                      <td className="py-2 text-end tabular-nums text-body">
                        {c.withOrder}
                        <span className="ms-1 text-xs text-mutedtext">({conversionPct(c.withOrder, c.users)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-mutedtext">{t("priceExpNote")}</p>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="neu p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-heading">{t("latestLeads")}</h2>
            <Link href="/dashboard/leads" className="text-xs font-semibold text-cobalt hover:underline">
              {t("seeAll")}
            </Link>
          </div>
          {leads.length === 0 ? (
            <p className="mt-4 text-sm text-mutedtext">{t("noLeads")}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {leads.map((l) => (
                <li key={l.id} className="rounded-xl bg-panel px-3 py-2 shadow-neu-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-heading">{l.name}</span>
                    <span className="shrink-0 text-[11px] text-mutedtext">{when(l.created_at as string)}</span>
                  </div>
                  <p className="truncate text-xs text-mutedtext">{stripLinksAndIds(String(l.message ?? "").split("\n")[0])}</p>
                  {l.status === "new" && <span className="text-[10px] font-semibold text-amber-700">{t("statusNew")}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="neu p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-heading">{t("latestOrders")}</h2>
            <Link href="/dashboard/store/orders" className="text-xs font-semibold text-cobalt hover:underline">
              {t("seeAll")}
            </Link>
          </div>
          {orders.length === 0 ? (
            <p className="mt-4 text-sm text-mutedtext">{t("noOrders")}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/dashboard/store/orders/${o.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2 shadow-neu-sm hover:text-cobalt"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-heading">{o.customer_name}</span>
                      <span className="block text-[11px] text-mutedtext">
                        #{String(o.id).slice(0, 8)} · {when(o.created_at as string)}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-sm font-semibold tabular-nums text-heading">{formatPrice(Number(o.total_qar), locale)}</span>
                      <span className="block text-[11px] text-mutedtext">{String(o.status)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
