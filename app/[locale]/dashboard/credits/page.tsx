import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { grantCredits } from "./actions";

// AI credits admin (0042): find a user → balances → grant → their ledger;
// plus AI calls per day per step from ai_usage_log. super_admin only (layout).

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  wiring: number;
  cad: number;
  last_entry: string | null;
};
type LedgerRow = {
  id: string;
  kind: string;
  delta: number;
  reason: string;
  note: string | null;
  redeemable_until: string | null;
  redeemed_order_id: string | null;
  created_at: string;
};
type UsageRow = {
  day: string;
  step: string;
  calls: number;
  ok_calls: number;
  tokens_in: number;
  tokens_out: number;
};

const field =
  "rounded-lg border border-white/60 bg-surface px-2.5 py-1.5 text-sm text-heading shadow-neu-inset";

export default async function CreditsAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; user?: string; granted?: string; err?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q, user: userId, granted, err } = await searchParams;
  const t = await getTranslations("Credits");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const date = (iso: string) =>
    new Date(iso).toLocaleString(isRtl ? "ar-QA" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  const supabase = await createClient();
  const [usersRes, usageRes] = await Promise.all([
    supabase.rpc("admin_credit_users", { p_query: q ?? null }),
    supabase.rpc("ai_usage_daily", { p_days: 14 }),
  ]);
  const notReady = !!usersRes.error;
  const users = (usersRes.data ?? []) as UserRow[];

  let selected: UserRow | null = null;
  let ledger: LedgerRow[] = [];
  if (userId && !notReady) {
    selected = users.find((u) => u.id === userId) ?? null;
    if (!selected) {
      const one = await supabase.rpc("admin_credit_users", { p_query: userId });
      selected = ((one.data ?? []) as UserRow[])[0] ?? null;
    }
    const { data } = await supabase
      .from("credits_ledger")
      .select("id, kind, delta, reason, note, redeemable_until, redeemed_order_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    ledger = (data ?? []) as LedgerRow[];
  }
  const usage = (usageRes.data ?? []) as UsageRow[];
  const th = "px-3 pb-2 text-start font-medium";
  const td = "px-3 py-2";

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("adminKicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("adminTitle")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{t("adminIntro")}</p>
      </div>

      {notReady && <p className="text-sm font-medium text-destructive">{t("needsMigration")}</p>}

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="flex flex-col gap-1 text-[11px] text-mutedtext">
          {t("adminSearch")}
          <input name="q" defaultValue={q ?? ""} placeholder={t("adminSearchPlaceholder")} className={field} />
        </label>
        <button type="submit" className="rounded-lg bg-cobalt px-3 py-1.5 text-xs font-semibold text-white hover:bg-cobalt-hover">
          {t("adminFind")}
        </button>
      </form>

      <div className="neu overflow-x-auto p-4">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={th}>{t("colUser")}</th>
              <th className={th}>{t("colRole")}</th>
              <th className={cn(th, "text-end")}>{t("kind_wiring")}</th>
              <th className={cn(th, "text-end")}>{t("kind_cad")}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {users.map((u) => (
              <tr key={u.id} className={cn(u.id === userId && "bg-cobalt/5")}>
                <td className={td}>
                  <span className="block font-semibold text-heading">{u.email}</span>
                  {u.full_name && <span className="text-[11.5px] text-mutedtext">{u.full_name}</span>}
                </td>
                <td className={cn(td, "text-[12px] text-mutedtext")}>{u.role}</td>
                <td className={cn(td, "text-end tabular-nums")}>{u.wiring}</td>
                <td className={cn(td, "text-end tabular-nums")}>{u.cad}</td>
                <td className={cn(td, "text-end")}>
                  <Link
                    href={{ pathname: "/dashboard/credits", query: { user: u.id, ...(q ? { q } : {}) } }}
                    className="text-xs font-semibold text-cobalt hover:text-cobalt-hover"
                  >
                    {t("adminOpen")}
                  </Link>
                </td>
              </tr>
            ))}
            {!users.length && !notReady && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-mutedtext">
                  {t("adminNoUsers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <section className="neu space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold text-heading">{selected.email}</h2>
            <p className="text-sm text-heading">
              {t("badge", { wiring: selected.wiring, cad: selected.cad })}
            </p>
          </div>

          {granted && <p className="rounded-xl bg-buy-bg px-3 py-2 text-sm text-buy">{t("adminGranted")}</p>}
          {err && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{t(`adminErr_${err}`)}</p>}

          <form action={grantCredits} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="user" value={selected.id} />
            {q && <input type="hidden" name="q" value={q} />}
            <label className="flex flex-col gap-1 text-[11px] text-mutedtext">
              {t("adminKind")}
              <select name="kind" className={field} defaultValue="wiring">
                <option value="wiring">{t("kind_wiring")}</option>
                <option value="cad">{t("kind_cad")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-mutedtext">
              {t("adminAmount")}
              <input name="amount" type="number" step={1} defaultValue={1} required className={cn(field, "w-24")} />
            </label>
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[11px] text-mutedtext">
              {t("adminNote")}
              <input name="note" required placeholder={t("adminNotePlaceholder")} className={field} />
            </label>
            <button type="submit" className="rounded-lg bg-cobalt px-3 py-1.5 text-xs font-semibold text-white hover:bg-cobalt-hover">
              {t("adminGrant")}
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className={th}>{t("colWhen")}</th>
                  <th className={th}>{t("colKind")}</th>
                  <th className={cn(th, "text-end")}>{t("colDelta")}</th>
                  <th className={th}>{t("colReason")}</th>
                  <th className={th}>{t("colRedeem")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {ledger.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className={cn(td, "whitespace-nowrap text-[12px] text-mutedtext")}>{date(l.created_at)}</td>
                    <td className={td}>{t(`kind_${l.kind}`)}</td>
                    <td className={cn(td, "text-end font-semibold tabular-nums", l.delta > 0 ? "text-buy" : "text-heading")}>
                      {l.delta > 0 ? `+${l.delta}` : l.delta}
                    </td>
                    <td className={td}>
                      <span className="font-mono text-[11px] text-heading">{l.reason}</span>
                      {l.note && <span className="block text-[11.5px] text-mutedtext">{l.note}</span>}
                    </td>
                    <td className={cn(td, "text-[12px] text-mutedtext")}>
                      {l.redeemed_order_id
                        ? t("redeemedOn", { order: l.redeemed_order_id.slice(0, 8) })
                        : l.redeemable_until
                          ? new Date(l.redeemable_until) > new Date()
                            ? t("redeemableUntil", { date: date(l.redeemable_until) })
                            : t("expired")
                          : "—"}
                    </td>
                  </tr>
                ))}
                {!ledger.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-mutedtext">
                      {t("adminNoLedger")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="neu space-y-3 p-5 sm:p-6">
        <h2 className="text-lg font-bold text-heading">{t("usageTitle")}</h2>
        <p className="text-sm text-mutedtext">{t("usageIntro")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-faint">
                <th className={th}>{t("colDay")}</th>
                <th className={th}>{t("colStep")}</th>
                <th className={cn(th, "text-end")}>{t("colCalls")}</th>
                <th className={cn(th, "text-end")}>{t("colOk")}</th>
                <th className={cn(th, "text-end")}>{t("colTokensIn")}</th>
                <th className={cn(th, "text-end")}>{t("colTokensOut")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borderstrong/40">
              {usage.map((u) => (
                <tr key={`${u.day}-${u.step}`}>
                  <td className={cn(td, "whitespace-nowrap")}>{u.day}</td>
                  <td className={td}>{u.step}</td>
                  <td className={cn(td, "text-end tabular-nums")}>{u.calls}</td>
                  <td className={cn(td, "text-end tabular-nums")}>{u.ok_calls}</td>
                  <td className={cn(td, "text-end tabular-nums")}>{Number(u.tokens_in).toLocaleString("en")}</td>
                  <td className={cn(td, "text-end tabular-nums")}>{Number(u.tokens_out).toLocaleString("en")}</td>
                </tr>
              ))}
              {!usage.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-mutedtext">
                    {t("usageEmpty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
