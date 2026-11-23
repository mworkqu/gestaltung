// "Sourcing" — where the products come from, what they cost us, and every
// price that moved. The price history is real: each nightly supplier sync
// stores the offers it changed in supplier_sync_runs.changes, so this section
// reads the actual old and new numbers rather than guessing from a snapshot.
//
// Pure: rows in, one Section out.

import {
  breakdown,
  daily,
  int,
  label,
  money,
  num,
  tally,
  within,
  type Section,
  type Table,
} from "@/lib/mobile/report";

export type SupplierRow = {
  id: string;
  code: string | null;
  name: string | null;
  active: boolean | null;
  commission_percent: number | string | null;
  default_currency: string | null;
};

export type OfferRow = {
  part_id: string | null;
  supplier_id: string | null;
  cost: number | string | null;
  retail_price: number | string | null;
  currency: string | null;
  availability: string | null;
  lead_time_days: number | null;
  last_checked_at: string | null;
  active: boolean | null;
};

/** One entry of supplier_sync_runs.changes (lib/sourcing/adapters/voltaat.ts OfferChange). */
export type OfferChangeRow = {
  partName?: string | null;
  oldRetail?: number | null;
  newRetail?: number | null;
  oldOurPrice?: number | null;
  newOurPrice?: number | null;
  oldAvailability?: string | null;
  newAvailability?: string | null;
};

export type SyncRunRow = {
  supplier_code: string | null;
  trigger: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  requests: number | null;
  checked: number | null;
  changed: number | null;
  missing: number | null;
  error: string | null;
  changes: unknown;
};

export type GapRow = {
  function: string | null;
  kind: string | null;
  quantity: number | null;
  first_seen: string | null;
  last_seen: string | null;
};

export type SourcingInput = {
  suppliers: SupplierRow[];
  offers: OfferRow[];
  runs: SyncRunRow[];
  gaps: GapRow[];
  windowDays: number;
  now?: number;
};

/** A price move, flattened out of the sync runs. */
type Move = {
  at: string;
  supplier: string;
  product: string;
  oldRetail: number | null;
  newRetail: number | null;
  oldOurs: number | null;
  newOurs: number | null;
  availability: string | null;
};

export function buildSourcing(input: SourcingInput): Section {
  const now = input.now ?? Date.now();
  const days = input.windowDays;

  const byId = new Map(input.suppliers.map((s) => [s.id, s]));
  const supplierName = (id: string | null | undefined) => (id && byId.get(id)?.name) || (id && byId.get(id)?.code) || "unknown";

  const activeOffers = input.offers.filter((o) => o.active !== false);
  const moves = priceMoves(input.runs).filter((m) => within(m.at, days, now));
  const up = moves.filter((m) => m.newRetail !== null && m.oldRetail !== null && m.newRetail > m.oldRetail);
  const down = moves.filter((m) => m.newRetail !== null && m.oldRetail !== null && m.newRetail < m.oldRetail);
  const wentAway = moves.filter((m) => m.availability && m.availability !== "in_stock");

  const lastRun = input.runs
    .filter((r) => r.started_at)
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
  const failedRuns = input.runs.filter((r) => within(r.started_at, days, now) && r.status !== "ok");

  // Stale: an offer nobody has re-checked for a week. The sync is nightly, so
  // anything older than that means the sync is not reaching it.
  const stale = activeOffers.filter((o) => !within(o.last_checked_at, 7, now));

  const unavailable = activeOffers.filter((o) => o.availability && o.availability !== "in_stock");

  const avgMargin = (() => {
    const pairs = activeOffers.filter((o) => num(o.cost) > 0 && num(o.retail_price) > 0);
    if (!pairs.length) return null;
    const total = pairs.reduce((s, o) => s + (num(o.retail_price) - num(o.cost)) / num(o.retail_price), 0);
    return total / pairs.length;
  })();

  const openGaps = input.gaps.filter((g) => within(g.last_seen, days, now));

  const tiles = [
    { label: "Suppliers", value: int(input.suppliers.filter((s) => s.active !== false).length), hint: `${int(input.suppliers.length)} on record` },
    { label: "Live offers", value: int(activeOffers.length), hint: "supplier prices we hold" },
    {
      label: "Prices up",
      value: int(up.length),
      tone: up.length ? ("warn" as const) : ("flat" as const),
      hint: `last ${days} days`,
    },
    {
      label: "Prices down",
      value: int(down.length),
      tone: down.length ? ("good" as const) : ("flat" as const),
      hint: `last ${days} days`,
    },
    {
      label: "Out of stock at supplier",
      value: int(unavailable.length),
      tone: unavailable.length ? ("warn" as const) : ("good" as const),
    },
    {
      label: "Not re-checked",
      value: int(stale.length),
      tone: stale.length ? ("bad" as const) : ("good" as const),
      hint: "no check in 7 days",
    },
    {
      label: "Last sync",
      value: lastRun?.status ? label(lastRun.status) : "never",
      tone: lastRun?.status === "ok" ? ("good" as const) : ("bad" as const),
      hint: lastRun?.started_at ? lastRun.started_at.slice(0, 10) : undefined,
    },
    {
      label: "Average margin",
      value: avgMargin === null ? "—" : `${Math.round(avgMargin * 100)}%`,
      hint: "retail against supplier cost",
    },
  ];

  const tables: Table[] = [
    {
      title: "Biggest price rises",
      columns: ["Product", "Was", "Now"],
      rows: [...up]
        .sort((a, b) => (b.newRetail! - b.oldRetail!) - (a.newRetail! - a.oldRetail!))
        .slice(0, 12)
        .map((m) => [m.product, money(m.oldRetail ?? 0), money(m.newRetail ?? 0)]),
      align: ["l", "r", "r"],
      empty: `No supplier raised a price in the last ${days} days.`,
    },
    {
      title: "Biggest price cuts",
      columns: ["Product", "Was", "Now"],
      rows: [...down]
        .sort((a, b) => (a.newRetail! - a.oldRetail!) - (b.newRetail! - b.oldRetail!))
        .slice(0, 12)
        .map((m) => [m.product, money(m.oldRetail ?? 0), money(m.newRetail ?? 0)]),
      align: ["l", "r", "r"],
      empty: `No supplier cut a price in the last ${days} days.`,
    },
    {
      title: "Gone out of stock",
      columns: ["Product", "Now"],
      rows: wentAway.slice(0, 12).map((m) => [m.product, label(m.availability)]),
      align: ["l", "l"],
      empty: "Nothing went out of stock.",
    },
    {
      title: "Offers by supplier",
      columns: ["Supplier", "Offers"],
      rows: tally(activeOffers, (o) => supplierName(o.supplier_id)).map(([name, n]) => [name, int(n)]),
      align: ["l", "r"],
      empty: "No offers on record.",
    },
    {
      title: "Sync runs",
      columns: ["Day", "Supplier", "Status", "Changed"],
      rows: [...input.runs]
        .filter((r) => r.started_at)
        .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))
        .slice(0, 12)
        .map((r) => [(r.started_at ?? "").slice(0, 10), r.supplier_code ?? "—", label(r.status), int(r.changed ?? 0)]),
      align: ["l", "l", "l", "r"],
      empty: "The price sync has not run.",
    },
    {
      title: "Asked for, not stocked",
      columns: ["What", "Kind", "Qty"],
      rows: openGaps.slice(0, 15).map((g) => [g.function ?? "—", label(g.kind), int(g.quantity ?? 0)]),
      align: ["l", "l", "r"],
      empty: "No gaps in this window.",
    },
    breakdown("Offer availability", tally(activeOffers, (o) => label(o.availability)), ["Availability", "Offers"]),
  ];

  const notes: string[] = [];
  if (failedRuns.length) notes.push(`${failedRuns.length} price sync run${failedRuns.length === 1 ? "" : "s"} did not finish cleanly in the last ${days} days.`);
  if (stale.length) notes.push(`${stale.length} offer${stale.length === 1 ? " has" : "s have"} not been re-checked in a week — the sync is not reaching them.`);
  if (up.length) notes.push(`${up.length} supplier price${up.length === 1 ? "" : "s"} went up; our shelf price follows automatically.`);
  if (unavailable.length) notes.push(`${unavailable.length} offer${unavailable.length === 1 ? " is" : "s are"} out of stock at the supplier.`);
  if (openGaps.length) notes.push(`${openGaps.length} thing${openGaps.length === 1 ? "" : "s"} were asked for that the catalogue does not carry.`);
  if (!notes.length) notes.push("Sourcing is quiet: prices steady, every offer freshly checked.");

  return {
    key: "sourcing",
    title: "Sourcing",
    symbol: "truck.box",
    blurb: "Where products come from, what they cost us, and every price that moved.",
    tiles,
    series: [
      { title: "Price changes a day", kind: "bar", points: daily(moves.map((m) => ({ at: m.at })), days, now) },
      {
        title: "Offers checked a day",
        kind: "line",
        points: daily(
          input.runs.filter((r) => within(r.started_at, days, now)).map((r) => ({ at: r.started_at, weight: r.checked ?? 0 })),
          days,
          now,
        ),
      },
    ],
    tables,
    notes,
  };
}

/** Flatten supplier_sync_runs.changes into one row per moved price. */
export function priceMoves(runs: SyncRunRow[]): Move[] {
  const out: Move[] = [];
  for (const run of runs) {
    if (!Array.isArray(run.changes)) continue;
    for (const raw of run.changes as OfferChangeRow[]) {
      if (!raw || typeof raw !== "object") continue;
      out.push({
        at: run.started_at ?? run.finished_at ?? "",
        supplier: run.supplier_code ?? "unknown",
        product: raw.partName ?? "unknown product",
        oldRetail: typeof raw.oldRetail === "number" ? raw.oldRetail : null,
        newRetail: typeof raw.newRetail === "number" ? raw.newRetail : null,
        oldOurs: typeof raw.oldOurPrice === "number" ? raw.oldOurPrice : null,
        newOurs: typeof raw.newOurPrice === "number" ? raw.newOurPrice : null,
        availability: raw.newAvailability ?? null,
      });
    }
  }
  return out.filter((m) => m.at);
}
