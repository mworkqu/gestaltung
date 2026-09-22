import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { PROVIDERS, dayStart, guardThreshold, nextReset, providerLimits, type ProviderId } from "@/lib/ai/limits";
import { cn } from "@/lib/utils";

// AI usage against the free allowances (migration 0023's ai_usage).
//
// Today per provider: calls, tokens / audio seconds, share of the daily
// allowance and where the guard stops calls. Then per feature, a 30-day chart
// of calls per day, and a per-project total — the figure subscriptions will
// be billed against. Every number here is counted from logged calls; limits
// come from lib/ai/limits.

export const dynamic = "force-dynamic";

type Row = {
  created_at: string;
  provider: string;
  feature: string;
  project_id: string | null;
  total_tokens: number | null;
  audio_seconds: number | null;
  outcome: string;
};

const DAYS = 30;

export default async function UsagePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AiUsage");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const num = new Intl.NumberFormat(locale === "ar" ? "ar-QA" : "en-GB");
  const pct = new Intl.NumberFormat(locale === "ar" ? "ar-QA" : "en-GB", { style: "percent", maximumFractionDigits: 1 });
  const dayFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const timeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Qatar",
  });

  const supabase = await createClient();
  const since = new Date(Date.now() - DAYS * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("ai_usage")
    .select("created_at, provider, feature, project_id, total_tokens, audio_seconds, outcome")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(20000);
  const rows = (data ?? []) as Row[];
  const called = (r: Row) => r.outcome !== "blocked";

  // ── Today, per provider, in the provider's own day ──
  const today = PROVIDERS.map((id: ProviderId) => {
    const lim = providerLimits(id);
    const start = dayStart(lim.resetTimeZone).getTime();
    const mine = rows.filter((r) => r.provider === id && new Date(r.created_at).getTime() >= start);
    const calls = mine.filter(called).length;
    const tokens = mine.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
    const audio = mine.reduce((s, r) => s + Number(r.audio_seconds ?? 0), 0);
    const blocked = mine.filter((r) => r.outcome === "blocked").length;
    const shares = [
      lim.requestsPerDay ? calls / lim.requestsPerDay : null,
      lim.tokensPerDay ? tokens / lim.tokensPerDay : null,
      lim.audioSecondsPerDay ? audio / lim.audioSecondsPerDay : null,
    ].filter((x): x is number => x !== null);
    const byFeature = new Map<string, { calls: number; tokens: number; audio: number }>();
    for (const r of mine.filter(called)) {
      const f = byFeature.get(r.feature) ?? { calls: 0, tokens: 0, audio: 0 };
      f.calls += 1;
      f.tokens += r.total_tokens ?? 0;
      f.audio += Number(r.audio_seconds ?? 0);
      byFeature.set(r.feature, f);
    }
    return { id, lim, calls, tokens, audio, blocked, share: shares.length ? Math.max(...shares) : null, byFeature, reset: nextReset(lim.resetTimeZone) };
  });

  // ── 30 days: calls per UTC day, all providers ──
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(since.getTime() + (i + 1) * 86400000);
    return { key: d.toISOString().slice(0, 10), date: d, calls: 0, tokens: 0 };
  });
  const dayIndex = new Map(days.map((d, i) => [d.key, i]));
  for (const r of rows.filter(called)) {
    const i = dayIndex.get(r.created_at.slice(0, 10));
    if (i === undefined) continue;
    days[i].calls += 1;
    days[i].tokens += r.total_tokens ?? 0;
  }
  const maxCalls = Math.max(1, ...days.map((d) => d.calls));

  // ── Per project, all time in the window ──
  const perProject = new Map<string, { calls: number; tokens: number; audio: number; last: string }>();
  for (const r of rows.filter((x) => called(x) && x.project_id)) {
    const p = perProject.get(r.project_id!) ?? { calls: 0, tokens: 0, audio: 0, last: r.created_at };
    p.calls += 1;
    p.tokens += r.total_tokens ?? 0;
    p.audio += Number(r.audio_seconds ?? 0);
    p.last = r.created_at;
    perProject.set(r.project_id!, p);
  }
  const ids = [...perProject.keys()];
  const { data: projects } = ids.length
    ? await supabase.from("projects").select("id, name").in("id", ids)
    : { data: [] as { id: string; name: string }[] };
  const nameOf = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const projectRows = [...perProject.entries()].sort((a, b) => b[1].tokens - a[1].tokens || b[1].calls - a[1].calls);

  // Chart geometry: one series, one axis, thin bars with 2px gaps.
  const W = 720;
  const H = 180;
  const PADL = 36;
  const PADB = 22;
  const bw = (W - PADL) / DAYS;
  const y = (v: number) => (H - PADB) * (1 - v / maxCalls);

  return (
    <div className="space-y-8">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">
          {t("intro", { threshold: pct.format(guardThreshold()) })}
        </p>
      </div>

      {error && <p className="text-sm font-medium text-destructive">{t("notReady")}</p>}

      <section className="grid gap-4 md:grid-cols-2">
        {today.map((p) => (
          <div key={p.id} className="neu space-y-3 p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-bold text-heading">{p.lim.label}</h2>
              <span className="text-[11px] text-mutedtext">
                {t("resets", { when: timeFmt.format(p.reset) })}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-center">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-faint">{t("callsToday")}</dt>
                <dd className="font-mono text-lg font-bold tabular-nums text-heading">
                  {num.format(p.calls)}
                  {p.lim.requestsPerDay != null && (
                    <span className="text-xs font-normal text-mutedtext"> / {num.format(p.lim.requestsPerDay)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-faint">
                  {p.id === "groq" ? t("audioToday") : t("tokensToday")}
                </dt>
                <dd className="font-mono text-lg font-bold tabular-nums text-heading">
                  {p.id === "groq" ? num.format(Math.round(p.audio)) : num.format(p.tokens)}
                  {p.id === "groq" && p.lim.audioSecondsPerDay != null && (
                    <span className="text-xs font-normal text-mutedtext"> / {num.format(p.lim.audioSecondsPerDay)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-faint">{t("allowanceUsed")}</dt>
                <dd className={cn("font-mono text-lg font-bold tabular-nums", p.share !== null && p.share >= guardThreshold() ? "text-destructive" : "text-heading")}>
                  {p.share === null ? "—" : pct.format(p.share)}
                </dd>
              </div>
            </dl>
            {p.share !== null && (
              <div className="relative h-2 overflow-hidden rounded-full bg-panel shadow-neu-inset" aria-hidden>
                <span className="absolute inset-y-0 start-0 rounded-full bg-cobalt" style={{ width: `${Math.min(100, p.share * 100)}%` }} />
                <span className="absolute inset-y-0 w-0.5 bg-destructive" style={{ insetInlineStart: `${guardThreshold() * 100}%` }} />
              </div>
            )}
            {p.blocked > 0 && <p className="text-[12px] font-medium text-destructive">{t("blockedToday", { count: p.blocked })}</p>}
            {p.id === "gemini" && p.lim.tokensPerDay == null && (
              <p className="text-[11px] text-mutedtext">{t("noTokenCap")}</p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className="pb-1 text-start font-medium">{t("feature")}</th>
                  <th className="pb-1 text-end font-medium">{t("calls")}</th>
                  <th className="pb-1 text-end font-medium">{p.id === "groq" ? t("audioSeconds") : t("tokens")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {[...p.byFeature.entries()].map(([f, v]) => (
                  <tr key={f}>
                    <td className="py-1.5 text-heading">{t(`feature_${f}`)}</td>
                    <td className="py-1.5 text-end font-mono tabular-nums">{num.format(v.calls)}</td>
                    <td className="py-1.5 text-end font-mono tabular-nums">
                      {num.format(p.id === "groq" ? Math.round(v.audio) : v.tokens)}
                    </td>
                  </tr>
                ))}
                {p.byFeature.size === 0 && (
                  <tr>
                    <td colSpan={3} className="py-1.5 text-mutedtext">{t("noneToday")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="neu space-y-3 p-6">
        <h2 className="text-base font-bold text-heading">{t("chartTitle", { days: DAYS })}</h2>
        <p className="text-[12px] text-mutedtext">{t("chartNote")}</p>
        <div className="overflow-x-auto" dir="ltr">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label={t("chartTitle", { days: DAYS })}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PADL} x2={W} y1={y(maxCalls * f)} y2={y(maxCalls * f)} stroke="currentColor" className="text-borderstrong" strokeOpacity={0.5} strokeWidth={1} />
                <text x={PADL - 6} y={y(maxCalls * f) + 3} fontSize={10} textAnchor="end" className="fill-mutedtext">
                  {num.format(Math.round(maxCalls * f))}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const h = (H - PADB) - y(d.calls);
              const x = PADL + i * bw + 1;
              return (
                <g key={d.key}>
                  {/* Hit target is the full column, larger than the bar. */}
                  <rect x={PADL + i * bw} y={0} width={bw} height={H - PADB} fill="transparent">
                    <title>{`${dayFmt.format(d.date)} — ${t("tooltip", { calls: d.calls, tokens: num.format(d.tokens) })}`}</title>
                  </rect>
                  {d.calls > 0 && (
                    <path
                      d={`M${x} ${H - PADB} V${H - PADB - h + Math.min(4, h)} q0 -${Math.min(4, h)} ${Math.min(4, h)} -${Math.min(4, h)} H${x + bw - 2 - Math.min(4, h)} q${Math.min(4, h)} 0 ${Math.min(4, h)} ${Math.min(4, h)} V${H - PADB} Z`}
                      className="pointer-events-none fill-cobalt"
                    />
                  )}
                  {i % 5 === 0 && (
                    <text x={x + (bw - 2) / 2} y={H - 6} fontSize={9.5} textAnchor="middle" className="fill-mutedtext">
                      {dayFmt.format(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      <section className="neu space-y-3 p-6">
        <h2 className="text-base font-bold text-heading">{t("perProject")}</h2>
        <p className="text-[12px] text-mutedtext">{t("perProjectNote", { days: DAYS })}</p>
        {projectRows.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("noProjects")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className="pb-2 text-start font-medium">{t("project")}</th>
                  <th className="pb-2 text-end font-medium">{t("calls")}</th>
                  <th className="pb-2 text-end font-medium">{t("tokens")}</th>
                  <th className="pb-2 text-end font-medium">{t("audioSeconds")}</th>
                  <th className="pb-2 text-end font-medium">{t("lastCall")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {projectRows.map(([id, v]) => (
                  <tr key={id}>
                    <td className="py-2 text-heading">{nameOf.get(id) ?? <span className="font-mono text-[11px] text-faint">{id.slice(0, 8)}</span>}</td>
                    <td className="py-2 text-end font-mono tabular-nums">{num.format(v.calls)}</td>
                    <td className="py-2 text-end font-mono tabular-nums">{num.format(v.tokens)}</td>
                    <td className="py-2 text-end font-mono tabular-nums">{num.format(Math.round(v.audio))}</td>
                    <td className="py-2 text-end text-[12px] text-mutedtext">{timeFmt.format(new Date(v.last))}</td>
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
