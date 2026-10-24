import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { modelPrice } from "@/lib/ai/prices";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { COST_MULTIPLIER, QAR_PER_USD, billableQar, needsMigration, qarFormatter, usdFormatter, type RevenueRow } from "./format";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { intlTag, asLocale } from "@/lib/locale";
import { dayFormatter, timeFormatter } from "@/lib/format/date";

// Per-user AI cost overview (owner, 2026-10-18): who uses the AI, how many
// ideation tokens they spent and what the calls cost us at the provider's
// paid list price. Rows come from admin_ai_cost_users (migration 0088, one
// row per user and model); rows logged before 0088 carry no cost, so their
// tokens are priced here with lib/ai/prices.

export const dynamic = "force-dynamic";

type RpcRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  is_anonymous: boolean;
  model: string | null;
  calls: number | string;
  tokens_in: number | string;
  tokens_out: number | string;
  cost_usd: number | string;
  tokens_unpriced_in: number | string;
  tokens_unpriced_out: number | string;
  last_call: string | null;
  projects: number | string;
  idea_used: number | string;
  idea_balance: number | string | null;
};

type UserAgg = {
  id: string;
  email: string | null;
  name: string | null;
  guest: boolean;
  projects: number;
  ideaUsed: number;
  balance: number;
  calls: number;
  tin: number;
  tout: number;
  cost: number;
  last: string | null;
  revenue: number;
  passUntil: string | null;
};

export default async function AiCostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const { q } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("AiCosts");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const loc = intlTag(asLocale(locale));
  const num = new Intl.NumberFormat(loc);
  const usd = usdFormatter(locale);
  const qar = qarFormatter(locale);
  const dayFmt = dayFormatter(asLocale(locale));
  const timeFmt = timeFormatter(asLocale(locale));
  const query = (typeof q === "string" ? q : "").trim().slice(0, 80);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_ai_cost_users", { p_query: query || null });
  const migrationMissing = needsMigration(error);
  // Revenue + pass per user (migration 0089). Failing here only hides those columns' data.
  const { data: revData } = await supabase.rpc("admin_revenue_users");
  const revenueBy = new Map(((revData ?? []) as RevenueRow[]).map((r) => [r.user_id, r]));
  const nowIso = new Date().toISOString();

  const byUser = new Map<string, UserAgg>();
  for (const r of (migrationMissing || error ? [] : (data ?? [])) as RpcRow[]) {
    const u: UserAgg = byUser.get(r.user_id) ?? {
      id: r.user_id,
      email: r.email,
      name: r.full_name,
      guest: !!r.is_anonymous,
      projects: Number(r.projects ?? 0),
      ideaUsed: Number(r.idea_used ?? 0),
      balance: Number(r.idea_balance ?? 0),
      calls: 0,
      tin: 0,
      tout: 0,
      cost: 0,
      last: null,
      revenue: Number(revenueBy.get(r.user_id)?.revenue_qar ?? 0),
      passUntil: (() => { const p = revenueBy.get(r.user_id)?.pass_until; return p && p > nowIso ? p : null; })(),
    };
    u.calls += Number(r.calls ?? 0);
    u.tin += Number(r.tokens_in ?? 0);
    u.tout += Number(r.tokens_out ?? 0);
    u.cost += Number(r.cost_usd ?? 0);
    // Pre-0088 rows: price their tokens now.
    const price = modelPrice(r.model);
    if (price) u.cost += (Number(r.tokens_unpriced_in ?? 0) * price.in + Number(r.tokens_unpriced_out ?? 0) * price.out) / 1_000_000;
    if (r.last_call && (!u.last || r.last_call > u.last)) u.last = r.last_call;
    byUser.set(r.user_id, u);
  }
  const users = [...byUser.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  const total = users.reduce(
    (s, u) => ({ calls: s.calls + u.calls, tin: s.tin + u.tin, tout: s.tout + u.tout, cost: s.cost + u.cost, idea: s.idea + u.ideaUsed }),
    { calls: 0, tin: 0, tout: 0, cost: 0, idea: 0 },
  );
  // Revenue totals cover every payer, not only the users in this (maybe filtered) list.
  const allRev = [...revenueBy.values()];
  const totalRevenue = query ? users.reduce((s, u) => s + u.revenue, 0) : allRev.reduce((s, r) => s + Number(r.revenue_qar ?? 0), 0);
  const activePasses = (query ? users.filter((u) => u.passUntil).map((u) => u.passUntil) : allRev.map((r) => r.pass_until)).filter((d) => d && d > nowIso).length;

  const stats: { label: string; value: string }[] = [
    { label: t("users"), value: num.format(users.length) },
    { label: t("calls"), value: num.format(total.calls) },
    { label: t("tokensIn"), value: num.format(total.tin) },
    { label: t("tokensOut"), value: num.format(total.tout) },
    { label: t("totalCost"), value: usd(total.cost) },
    { label: t("billable"), value: qar(billableQar(total.cost)) },
    { label: t("ideaUsed"), value: num.format(total.idea) },
    { label: t("totalRevenue"), value: qar(totalRevenue) },
    { label: t("activePasses"), value: num.format(activePasses) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{t("intro")}</p>
      </div>

      {migrationMissing ? (
        <p className="text-sm font-medium text-destructive">{t("needsMigration")}</p>
      ) : error ? (
        <p className="text-sm font-medium text-destructive">{t("loadError")}</p>
      ) : (
        <>
          <form method="get" className="neu flex flex-wrap items-center gap-3 p-4">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder={t("searchPlaceholder")}
              className="min-w-[220px] flex-1 rounded-xl bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset outline-none"
            />
            <button type="submit" className="rounded-xl bg-panel px-4 py-2 text-sm font-semibold text-heading shadow-neu-sm">
              {t("search")}
            </button>
            {query && (
              <Link href="/dashboard/ai-costs" className="text-[12px] text-mutedtext underline">
                {t("clear")}
              </Link>
            )}
          </form>

          <section className="neu p-6">
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-[10px] uppercase tracking-wider text-faint">{s.label}</dt>
                  <dd className="font-mono text-lg font-bold tabular-nums text-heading">{s.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[12px] text-mutedtext">{t("priceNote")}</p>
            <p className="mt-1 text-[12px] text-mutedtext">{t("qarNote", { value: qar(total.cost * QAR_PER_USD), rate: QAR_PER_USD })}</p>
            <p className="mt-1 text-[12px] text-mutedtext">{t("billableNote", { multiplier: COST_MULTIPLIER })}</p>
          </section>

          <section className="neu space-y-3 p-6">
            <h2 className="text-base font-bold text-heading">{t("usersTitle")}</h2>
            {users.length === 0 ? (
              <p className="text-sm text-mutedtext">{t("noUsers")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-faint">
                      <th className="pb-2 text-start font-medium">{t("user")}</th>
                      <th className="pb-2 text-end font-medium">{t("projects")}</th>
                      <th className="pb-2 text-end font-medium">{t("ideaUsed")}</th>
                      <th className="pb-2 text-end font-medium">{t("ideaBalance")}</th>
                      <th className="pb-2 text-end font-medium">{t("calls")}</th>
                      <th className="pb-2 text-end font-medium">{t("tokensIn")}</th>
                      <th className="pb-2 text-end font-medium">{t("tokensOut")}</th>
                      <th className="pb-2 text-end font-medium">{t("cost")}</th>
                      <th className="pb-2 text-end font-medium">{t("billable")}</th>
                      <th className="pb-2 text-end font-medium">{t("revenue")}</th>
                      <th className="pb-2 text-end font-medium">{t("pass")}</th>
                      <th className="pb-2 text-end font-medium">{t("lastCall")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borderstrong/40">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="py-2 text-heading">
                          <Link href={`/dashboard/ai-costs/${u.id}`} className="font-medium underline-offset-2 hover:underline">
                            {u.email && !u.guest ? u.email : `${t("guest")} ${u.id.slice(0, 8)}`}
                          </Link>
                        </td>
                        <td className="py-2 text-end font-mono tabular-nums">{num.format(u.projects)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{num.format(u.ideaUsed)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{num.format(u.balance)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{num.format(u.calls)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{num.format(u.tin)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{num.format(u.tout)}</td>
                        <td className="py-2 text-end font-mono font-semibold tabular-nums text-heading">{usd(u.cost)}
                          <span className="block text-[10px] font-normal text-faint">{qar(u.cost * QAR_PER_USD)}</span>
                        </td>
                        <td className="py-2 text-end font-mono font-semibold tabular-nums text-heading">{qar(billableQar(u.cost))}</td>
                        <td className="py-2 text-end font-mono tabular-nums text-heading">{u.revenue > 0 ? qar(u.revenue) : "—"}</td>
                        <td className="py-2 text-end text-[12px] text-mutedtext">{u.passUntil ? dayFmt.format(new Date(u.passUntil)) : "—"}</td>
                        <td className="py-2 text-end text-[12px] text-mutedtext">{u.last ? timeFmt.format(new Date(u.last)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
