// "CAD & AI" — the machine side of the site: drawings generated, analyses run,
// what the models cost, and what failed.
//
// Pure: rows in, one Section out.

import {
  breakdown,
  daily,
  delta,
  int,
  inPreviousWindow,
  label,
  num,
  pct,
  tally,
  toneUp,
  within,
  type Section,
  type Table,
} from "@/lib/mobile/report";

export type CadRow = {
  project_id: string | null;
  user_id: string | null;
  tier: string | null;
  status: string | null;
  error: string | null;
  charged: boolean | null;
  model: string | null;
  created_at: string | null;
  delivered_at: string | null;
};

export type AnalysisRow = {
  project_id: string | null;
  feature: string | null;
  provider: string | null;
  model: string | null;
  outcome: string | null;
  error: string | null;
  created_at: string | null;
};

export type UsageRow = {
  provider: string | null;
  model: string | null;
  feature: string | null;
  outcome: string | null;
  error_code: string | null;
  total_tokens: number | null;
  cost_usd: number | string | null;
  latency_ms: number | null;
  created_at: string | null;
  is_test: boolean | null;
};

export type CreditRow = { kind: string | null; delta: number | null; reason: string | null; created_at: string | null };

export type CadInput = {
  cad: CadRow[];
  analyses: AnalysisRow[];
  usage: UsageRow[];
  credits: CreditRow[];
  windowDays: number;
  now?: number;
};

export function buildCad(input: CadInput): Section {
  const now = input.now ?? Date.now();
  const days = input.windowDays;

  const cadNow = input.cad.filter((c) => within(c.created_at, days, now));
  const cadBefore = input.cad.filter((c) => inPreviousWindow(c.created_at, days, now));
  const delivered = cadNow.filter((c) => c.status === "delivered");
  const cadFailed = cadNow.filter((c) => c.status === "failed" || c.error);

  const anaNow = input.analyses.filter((a) => within(a.created_at, days, now));
  const anaOk = anaNow.filter((a) => a.outcome === "ok");
  const anaFailed = anaNow.filter((a) => a.outcome && a.outcome !== "ok");

  const useNow = input.usage.filter((u) => u.is_test !== true && within(u.created_at, days, now));
  const useBefore = input.usage.filter((u) => u.is_test !== true && inPreviousWindow(u.created_at, days, now));
  const costNow = useNow.reduce((s, u) => s + num(u.cost_usd), 0);
  const costBefore = useBefore.reduce((s, u) => s + num(u.cost_usd), 0);
  const tokensNow = useNow.reduce((s, u) => s + (u.total_tokens ?? 0), 0);

  const latencies = useNow.map((u) => u.latency_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null;

  const usageFailed = useNow.filter((u) => u.outcome && u.outcome !== "ok");

  const creditsNow = input.credits.filter((c) => within(c.created_at, days, now));
  const spent = creditsNow.filter((c) => (c.delta ?? 0) < 0).reduce((s, c) => s + Math.abs(c.delta ?? 0), 0);
  const granted = creditsNow.filter((c) => (c.delta ?? 0) > 0).reduce((s, c) => s + (c.delta ?? 0), 0);

  const tiles = [
    {
      label: "Drawings generated",
      value: int(cadNow.length),
      delta: delta(cadNow.length, cadBefore.length),
      tone: toneUp(cadNow.length, cadBefore.length),
      hint: `last ${days} days`,
    },
    {
      label: "Delivered",
      value: cadNow.length ? pct(delivered.length, cadNow.length) : "—",
      tone: cadNow.length && delivered.length / cadNow.length >= 0.8 ? ("good" as const) : ("warn" as const),
      hint: `${int(delivered.length)} of ${int(cadNow.length)}`,
    },
    {
      label: "CAD failures",
      value: int(cadFailed.length),
      tone: cadFailed.length ? ("bad" as const) : ("good" as const),
    },
    { label: "Analyses run", value: int(anaNow.length), hint: `last ${days} days` },
    {
      label: "Analyses failed",
      value: int(anaFailed.length),
      tone: anaFailed.length ? ("warn" as const) : ("good" as const),
      hint: anaNow.length ? pct(anaFailed.length, anaNow.length) : undefined,
    },
    {
      label: "Model spend",
      value: costNow ? `$${(Math.round(costNow * 100) / 100).toFixed(2)}` : "$0",
      delta: delta(costNow, costBefore),
      tone: costNow > costBefore ? ("warn" as const) : ("good" as const),
      hint: `last ${days} days`,
    },
    { label: "Tokens", value: int(tokensNow), hint: `last ${days} days` },
    {
      label: "Slowest answers",
      value: p95 === null ? "—" : `${(p95 / 1000).toFixed(1)} s`,
      hint: "95th percentile",
    },
    {
      label: "Credits spent",
      value: int(spent),
      hint: `${int(granted)} granted in the same window`,
    },
    {
      label: "Model calls failed",
      value: int(usageFailed.length),
      tone: usageFailed.length ? ("warn" as const) : ("good" as const),
      hint: useNow.length ? pct(usageFailed.length, useNow.length) : undefined,
    },
  ];

  const tables: Table[] = [
    breakdown("CAD by status", tally(input.cad, (c) => label(c.status)), ["Status", "Drawings"]),
    breakdown("CAD by tier", tally(cadNow, (c) => label(c.tier)), ["Tier", "Drawings"]),
    breakdown("Analyses by feature", tally(anaNow, (a) => label(a.feature)), ["Feature", "Runs"]),
    {
      title: "Spend by model",
      columns: ["Model", "Calls", "USD"],
      rows: tally(useNow, (u) => u.model).slice(0, 12).map(([model, n]) => [
        model,
        int(n),
        `$${(Math.round(useNow.filter((u) => u.model === model).reduce((s, u) => s + num(u.cost_usd), 0) * 100) / 100).toFixed(2)}`,
      ]),
      align: ["l", "r", "r"],
      empty: "No model calls in this window.",
    },
    breakdown("By provider", tally(useNow, (u) => label(u.provider)), ["Provider", "Calls"]),
    {
      title: "What went wrong",
      columns: ["Error", "Times"],
      rows: tally([...usageFailed, ...anaFailed.map((a) => ({ error_code: a.error ?? a.outcome }))] as { error_code: string | null }[], (r) =>
        (r.error_code ?? "").slice(0, 60) || null,
      )
        .slice(0, 12)
        .map(([code, n]) => [code, int(n)]),
      align: ["l", "r"],
      empty: "Nothing failed in this window.",
    },
    breakdown("Credits by reason", tally(creditsNow, (c) => label(c.reason || c.kind)), ["Reason", "Entries"]),
  ];

  const notes: string[] = [];
  if (cadFailed.length) notes.push(`${cadFailed.length} drawing${cadFailed.length === 1 ? "" : "s"} failed to generate.`);
  if (anaNow.length && anaFailed.length / anaNow.length > 0.1)
    notes.push(`${pct(anaFailed.length, anaNow.length)} of analyses failed — above one in ten.`);
  if (costNow > costBefore * 1.5 && costBefore > 0) notes.push(`Model spend is up sharply: $${costNow.toFixed(2)} against $${costBefore.toFixed(2)} the window before.`);
  if (p95 !== null && p95 > 15_000) notes.push(`The slowest model answers take over ${(p95 / 1000).toFixed(0)} seconds.`);
  if (anaOk.length) notes.push(`${anaOk.length} analysis run${anaOk.length === 1 ? "" : "s"} finished cleanly.`);
  if (!notes.length) notes.push("The machine side is healthy: nothing failing, spend steady.");

  return {
    key: "cad",
    title: "CAD & AI",
    symbol: "cube.transparent",
    blurb: "Drawings generated, analyses run, what the models cost, what failed.",
    tiles,
    series: [
      { title: "Drawings a day", kind: "bar", points: daily(cadNow.map((c) => ({ at: c.created_at })), days, now) },
      { title: "Analyses a day", kind: "bar", points: daily(anaNow.map((a) => ({ at: a.created_at })), days, now) },
      {
        title: "Model spend a day",
        kind: "bar",
        unit: "USD",
        points: daily(useNow.map((u) => ({ at: u.created_at, weight: num(u.cost_usd) })), days, now),
      },
    ],
    tables,
    notes,
  };
}
