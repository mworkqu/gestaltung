import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { UUID_RE, needsMigration, rowCost, usdFormatter, type CallRow } from "../format";

// One user's AI cost: projects (with ideation tokens used), per-model totals
// and the latest calls. Costs are the stored ai_usage.cost_usd, or the paid
// list price of the same tokens for rows logged before migration 0088.

export const dynamic = "force-dynamic";

type UsageRow = CallRow & {
  created_at: string;
  project_id: string | null;
  feature: string;
  step: string | null;
  outcome: string;
};

type Agg = { calls: number; tin: number; tout: number; cost: number; unpriced: boolean };
const blank = (): Agg => ({ calls: 0, tin: 0, tout: 0, cost: 0, unpriced: false });

function add(a: Agg, r: UsageRow) {
  if (r.outcome === "blocked") return;
  a.calls += 1;
  a.tin += r.prompt_tokens ?? 0;
  a.tout += r.completion_tokens ?? 0;
  const c = rowCost(r);
  if (c == null) a.unpriced = true;
  else a.cost += c;
}

export default async function AiCostsUserPage({ params }: { params: Promise<{ locale: string; userId: string }> }) {
  const { locale, userId } = await params;
  if (!UUID_RE.test(userId)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("AiCosts");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const loc = isRtl ? "ar-QA-u-nu-latn" : "en-GB";
  const num = new Intl.NumberFormat(loc);
  const usd = usdFormatter(locale);
  const dayFmt = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Qatar" });
  const timeFmt = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Qatar" });

  const supabase = await createClient();
  const [usageRes, projectsRes, sessionsRes, ledgerRes, profileRes] = await Promise.all([
    supabase
      .from("ai_usage")
      .select("created_at, project_id, feature, step, model, prompt_tokens, completion_tokens, total_tokens, audio_seconds, outcome, cost_usd")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20000),
    supabase.from("projects").select("id, name, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("idea_sessions").select("project_id, edit_turns, tier").eq("user_id", userId),
    supabase.from("credits_ledger").select("delta, reason").eq("user_id", userId).eq("kind", "idea"),
    supabase.from("profiles").select("email, full_name").eq("id", userId).maybeSingle(),
  ]);

  const missing = [usageRes.error, sessionsRes.error, ledgerRes.error].some((e) => needsMigration(e));
  if (missing) {
    return (
      <div className="space-y-4">
        <BackLink label={t("back")} />
        <p className="text-sm font-medium text-destructive">{t("needsMigration")}</p>
      </div>
    );
  }
  if (usageRes.error) {
    return (
      <div className="space-y-4">
        <BackLink label={t("back")} />
        <p className="text-sm font-medium text-destructive">{t("loadError")}</p>
      </div>
    );
  }

  const usage = (usageRes.data ?? []) as UsageRow[];
  const projects = (projectsRes.data ?? []) as { id: string; name: string | null; created_at: string }[];
  const sessions = new Map((sessionsRes.data ?? []).map((s) => [s.project_id as string, s as { edit_turns: number; tier: string }]));
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));

  // Ideation tokens spent: -delta of 'idea:<project_id>' ledger rows.
  const ideaByProject = new Map<string, number>();
  let ideaTotal = 0;
  let balance = 0;
  for (const l of ledgerRes.data ?? []) {
    balance += Number(l.delta);
    const m = /^idea:(.+)$/.exec(l.reason ?? "");
    if (!m) continue;
    const spent = -Number(l.delta);
    ideaByProject.set(m[1], (ideaByProject.get(m[1]) ?? 0) + spent);
    ideaTotal += spent;
  }

  // Aggregates: overall, per project (null = no project) and per model.
  const all = blank();
  const perProject = new Map<string | null, Agg>();
  const perModel = new Map<string, Agg>();
  for (const r of usage) {
    add(all, r);
    const p = perProject.get(r.project_id) ?? blank();
    add(p, r);
    perProject.set(r.project_id, p);
    const key = r.model ?? "—";
    const m = perModel.get(key) ?? blank();
    add(m, r);
    perModel.set(key, m);
  }

  // Projects table: every project the user owns, plus any that only show up
  // in the ledger or the usage log (e.g. deleted ones).
  const projectIds = new Set<string>([...projects.map((p) => p.id), ...ideaByProject.keys(), ...[...perProject.keys()].filter((k): k is string => !!k)]);
  const projectRows = [...projectIds]
    .map((id) => ({ id, agg: perProject.get(id) ?? blank(), idea: ideaByProject.get(id) ?? 0 }))
    .sort((a, b) => b.agg.cost - a.agg.cost || b.idea - a.idea);
  const noProject = perProject.get(null);

  const profile = profileRes.data as { email: string | null; full_name: string | null } | null;
  const title = profile?.email ?? `${t("guest")} ${userId.slice(0, 8)}`;
  const tierLabel = (tier: string | undefined) => (tier === "explorer" || tier === "maker" || tier === "engineer" ? t(`tier_${tier}`) : "—");
  const cost = (a: Agg) => (a.calls > 0 && a.cost === 0 && a.unpriced ? "—" : usd(a.cost));

  const stats: { label: string; value: string }[] = [
    { label: t("calls"), value: num.format(all.calls) },
    { label: t("tokensIn"), value: num.format(all.tin) },
    { label: t("tokensOut"), value: num.format(all.tout) },
    { label: t("totalCost"), value: cost(all) },
    { label: t("ideaUsed"), value: num.format(ideaTotal) },
    { label: t("ideaBalance"), value: num.format(balance) },
  ];

  const th = "pb-2 font-medium";
  const tdn = "py-2 text-end font-mono tabular-nums";

  return (
    <div className="space-y-8">
      <div>
        <BackLink label={t("back")} />
        <p className={mono("mt-3 text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">
          <span dir="ltr">{title}</span>
        </h1>
        <p className="mt-1 text-sm text-mutedtext">
          {[profile?.full_name, !profile?.email ? t("guestFlag") : null, userId].filter(Boolean).join(" · ")}
        </p>
      </div>

      <section className="neu p-6">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-[10px] uppercase tracking-wider text-faint">{s.label}</dt>
              <dd className="font-mono text-lg font-bold tabular-nums text-heading">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[12px] text-mutedtext">{t("priceNote")}</p>
      </section>

      <section className="neu space-y-3 p-6">
        <h2 className="text-base font-bold text-heading">{t("projectsTitle")}</h2>
        {projectRows.length === 0 && !noProject ? (
          <p className="text-sm text-mutedtext">{t("noProjects")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className={cn(th, "text-start")}>{t("project")}</th>
                  <th className={cn(th, "text-start")}>{t("created")}</th>
                  <th className={cn(th, "text-start")}>{t("tier")}</th>
                  <th className={cn(th, "text-end")}>{t("editTurns")}</th>
                  <th className={cn(th, "text-end")}>{t("ideaUsed")}</th>
                  <th className={cn(th, "text-end")}>{t("calls")}</th>
                  <th className={cn(th, "text-end")}>{t("tokensIn")}</th>
                  <th className={cn(th, "text-end")}>{t("tokensOut")}</th>
                  <th className={cn(th, "text-end")}>{t("cost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {projectRows.map(({ id, agg, idea }) => {
                  const p = projects.find((x) => x.id === id);
                  const s = sessions.get(id);
                  return (
                    <tr key={id}>
                      <td className="py-2 text-heading">{p ? p.name || t("untitled") : <span className="font-mono text-[11px] text-faint">{id.slice(0, 8)}</span>}</td>
                      <td className="py-2 text-[12px] text-mutedtext">{p ? dayFmt.format(new Date(p.created_at)) : "—"}</td>
                      <td className="py-2 text-[12px] text-body">{tierLabel(s?.tier)}</td>
                      <td className={tdn}>{s ? num.format(s.edit_turns) : "—"}</td>
                      <td className={tdn}>{num.format(idea)}</td>
                      <td className={tdn}>{num.format(agg.calls)}</td>
                      <td className={tdn}>{num.format(agg.tin)}</td>
                      <td className={tdn}>{num.format(agg.tout)}</td>
                      <td className={cn(tdn, "font-semibold text-heading")}>{cost(agg)}</td>
                    </tr>
                  );
                })}
                {noProject && (
                  <tr>
                    <td className="py-2 text-mutedtext" colSpan={5}>{t("noProjectRow")}</td>
                    <td className={tdn}>{num.format(noProject.calls)}</td>
                    <td className={tdn}>{num.format(noProject.tin)}</td>
                    <td className={tdn}>{num.format(noProject.tout)}</td>
                    <td className={cn(tdn, "font-semibold text-heading")}>{cost(noProject)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="neu space-y-3 p-6">
        <h2 className="text-base font-bold text-heading">{t("perModel")}</h2>
        {perModel.size === 0 ? (
          <p className="text-sm text-mutedtext">{t("noCalls")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className={cn(th, "text-start")}>{t("model")}</th>
                  <th className={cn(th, "text-end")}>{t("calls")}</th>
                  <th className={cn(th, "text-end")}>{t("tokensIn")}</th>
                  <th className={cn(th, "text-end")}>{t("tokensOut")}</th>
                  <th className={cn(th, "text-end")}>{t("cost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {[...perModel.entries()]
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([model, a]) => (
                    <tr key={model}>
                      <td className="py-2 font-mono text-[12px] text-heading" dir="ltr">{model}</td>
                      <td className={tdn}>{num.format(a.calls)}</td>
                      <td className={tdn}>{num.format(a.tin)}</td>
                      <td className={tdn}>{num.format(a.tout)}</td>
                      <td className={cn(tdn, "font-semibold text-heading")}>{cost(a)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="neu space-y-3 p-6">
        <h2 className="text-base font-bold text-heading">{t("lastCalls", { count: Math.min(300, usage.length) })}</h2>
        {usage.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("noCalls")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className={cn(th, "text-start")}>{t("time")}</th>
                  <th className={cn(th, "text-start")}>{t("project")}</th>
                  <th className={cn(th, "text-start")}>{t("featureStep")}</th>
                  <th className={cn(th, "text-start")}>{t("model")}</th>
                  <th className={cn(th, "text-end")}>{t("tokensIn")}</th>
                  <th className={cn(th, "text-end")}>{t("tokensOut")}</th>
                  <th className={cn(th, "text-end")}>{t("cost")}</th>
                  <th className={cn(th, "text-end")}>{t("outcome")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {usage.slice(0, 300).map((r, i) => (
                  <tr key={`${r.created_at}-${i}`}>
                    <td className="whitespace-nowrap py-1.5 text-[12px] text-mutedtext">{timeFmt.format(new Date(r.created_at))}</td>
                    <td className="py-1.5 text-heading">
                      {r.project_id ? (nameOf.get(r.project_id) ?? <span className="font-mono text-[11px] text-faint">{r.project_id.slice(0, 8)}</span>) : "—"}
                    </td>
                    <td className="py-1.5 font-mono text-[12px] text-body" dir="ltr">{r.step ? `${r.feature} / ${r.step}` : r.feature}</td>
                    <td className="py-1.5 font-mono text-[12px] text-body" dir="ltr">{r.model ?? "—"}</td>
                    <td className={tdn}>{num.format(r.prompt_tokens ?? 0)}</td>
                    <td className={tdn}>{num.format(r.completion_tokens ?? 0)}</td>
                    <td className={tdn}>{usd(rowCost(r))}</td>
                    <td className={cn("py-1.5 text-end text-[12px]", r.outcome === "ok" ? "text-mutedtext" : "font-medium text-destructive")}>{r.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link href="/dashboard/ai-costs" className="text-[12px] text-mutedtext underline-offset-2 hover:underline">
      {label}
    </Link>
  );
}
