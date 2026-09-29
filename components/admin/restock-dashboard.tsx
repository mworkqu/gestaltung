"use client";

// Restock dashboard (Task 20). Ranked products with the raw signal counts
// beside the score, a draft order grouped by supplier against each
// supplier's minimum order value, CSV export, "received" to serve the
// demand, and the demand for things we don't carry at all.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Download, Loader2, PackageCheck, Save } from "lucide-react";

import { markReceived, saveRestockWeights, saveSupplierMinimum } from "@/app/[locale]/dashboard/store/restock/actions";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/parts/format";
import { draftCsv, groupDraft, orderQty, type RestockRow, type RestockWeights } from "@/lib/store/restock";
import { cn } from "@/lib/utils";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-2 py-1 text-[12px] text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

export type SummaryExtras = {
  searches: { term: string; n: number; last_seen: string }[];
  bom: { label: string; projects: number; quantity: number; last_seen: string }[];
  receipts: { id: string; part_id: string; part_name: string; quantity: number; received_at: string; served: number; sold_since: number; carts_since: number }[];
};

export function RestockDashboard({
  locale,
  rows,
  weights,
  extras,
  bomWeight,
}: {
  locale: string;
  rows: RestockRow[];
  weights: RestockWeights;
  extras: SummaryExtras;
  bomWeight: number;
}) {
  const t = useTranslations("Restock");
  const tD = useTranslations("Delivery");
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [receiving, setReceiving] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const money = (n: number | null) => (n === null ? "—" : formatPrice(n, locale));
  const date = (s: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", { dateStyle: "medium" }).format(new Date(s));

  const groups = useMemo(
    () => groupDraft(rows.filter((r) => picked[r.partId] !== undefined).map((r) => ({ row: r, qty: picked[r.partId] }))),
    [rows, picked]
  );

  const toggle = (r: RestockRow) =>
    setPicked((cur) => {
      const next = { ...cur };
      if (next[r.partId] !== undefined) delete next[r.partId];
      else next[r.partId] = orderQty(r);
      return next;
    });

  const exportCsv = () => {
    const blob = new Blob(["﻿" + draftCsv(groups)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `draft-order-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <WeightsEditor locale={locale} initial={weights} />

      {/* Ranked products */}
      <section className="neu space-y-3 p-4">
        <h2 className="text-base font-bold text-heading">{t("rankedTitle", { n: rows.length })}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("noDemand")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-mutedtext">
                  {["", "product", "score", "signals", "supplier", "cost", "price", "margin", "moq", "lead", "revenue", ""].map((k, i) => (
                    <th key={i} className={cn("px-2 py-2 font-semibold", ["cost", "price", "margin", "moq", "revenue", "score"].includes(k) ? "text-end" : "text-start")}>
                      {k ? t(`col_${k}`) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const on = picked[r.partId] !== undefined;
                  return (
                    <tr key={r.partId} className={cn("border-t border-borderstrong/40 align-top", on && "bg-cobalt/5")}>
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={on} onChange={() => toggle(r)} aria-label={t("addToDraft")} />
                      </td>
                      <td className="px-2 py-2">
                        <Link href={`/dashboard/store/${r.partId}/edit`} className="font-medium text-heading hover:text-cobalt">
                          {r.name}
                        </Link>
                        <span className="block font-mono text-[10.5px] text-faint">{r.sku}</span>
                      </td>
                      <td className="px-2 py-2 text-end text-sm font-bold tabular-nums text-heading">{r.score}</td>
                      <td className="px-2 py-2 tabular-nums text-body">
                        {t("signals", { requests: r.counts.requests, qty: r.counts.requestedQty, carts: r.counts.carts, views: r.counts.views })}
                      </td>
                      <td className="px-2 py-2">
                        {r.supplier ? (
                          <>
                            {r.supplier.name}
                            {r.supplierSku && <span className="block font-mono text-[10.5px] text-faint">{r.supplierSku}</span>}
                          </>
                        ) : (
                          <span className="text-amber-700">{t("noSupplier")}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums">{money(r.landedCost)}</td>
                      <td className="px-2 py-2 text-end tabular-nums">{money(r.price)}</td>
                      <td className="px-2 py-2 text-end tabular-nums">
                        {money(r.income)}
                        {r.incomePct !== null && <span className="block text-[10.5px] text-mutedtext">{r.incomePct}%</span>}
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums">{r.moq}</td>
                      <td className="px-2 py-2">{r.leadTimeClass ? tD(`lt_${r.leadTimeClass}`) : tD("lt_on_request")}</td>
                      <td className="px-2 py-2 text-end tabular-nums">
                        {money(r.estRevenue)}
                        <span className="block text-[10.5px] text-mutedtext">{t("units", { n: r.units })}</span>
                      </td>
                      <td className="px-2 py-2">
                        {receiving === r.partId ? (
                          <ReceiveForm
                            onCancel={() => setReceiving(null)}
                            pending={pending}
                            defaultQty={picked[r.partId] ?? orderQty(r)}
                            onSave={(qty) =>
                              start(async () => {
                                await markReceived(locale, r.partId, r.supplier?.id ?? null, qty);
                                setReceiving(null);
                                router.refresh();
                              })
                            }
                          />
                        ) : (
                          <button type="button" onClick={() => setReceiving(r.partId)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-borderstrong px-2.5 py-1 text-[11px] hover:border-cobalt">
                            <PackageCheck className="h-3.5 w-3.5" /> {t("received")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-mutedtext">{t("legend")}</p>
      </section>

      {/* Draft order */}
      <section className="neu space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-heading">{t("draftTitle")}</h2>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!groups.length}
            className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> {t("exportCsv")}
          </button>
        </div>
        {!groups.length ? (
          <p className="text-sm text-mutedtext">{t("draftEmpty")}</p>
        ) : (
          groups.map((g) => (
            <div key={g.supplierId ?? "none"} className="rounded-xl bg-panel p-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-bold text-heading">{g.supplierName || t("noSupplier")}</span>
                <span className="tabular-nums text-heading">{money(g.total)}</span>
                {g.unpriced > 0 && <span className="text-[11px] text-amber-700">{t("unpriced", { n: g.unpriced })}</span>}
                {g.supplierId && (
                  <MinimumEditor locale={locale} supplierId={g.supplierId} value={g.minOrderValue} below={g.belowMinimum} total={g.total} />
                )}
              </div>
              <ul className="mt-2 space-y-1 text-[12.5px]">
                {g.lines.map((l) => (
                  <li key={l.row.partId} className="flex flex-wrap items-center gap-2">
                    <input
                      value={picked[l.row.partId]}
                      onChange={(e) => setPicked((cur) => ({ ...cur, [l.row.partId]: Math.max(1, Math.trunc(Number(e.target.value)) || 1) }))}
                      inputMode="numeric"
                      aria-label={t("qty")}
                      className={cn(input, "w-16 text-end")}
                      dir="ltr"
                    />
                    <span className="text-heading">{l.row.name}</span>
                    <span className="font-mono text-[10.5px] text-faint">{l.row.supplierSku}</span>
                    {l.qty < l.row.moq && <span className="text-[11px] text-red-700">{t("belowMoq", { moq: l.row.moq })}</span>}
                    <span className="ms-auto tabular-nums text-mutedtext">{l.row.landedCost === null ? "—" : money(l.row.landedCost * l.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* Not in the catalogue at all */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="neu space-y-2 p-4">
          <h2 className="text-base font-bold text-heading">{t("searchesTitle")}</h2>
          <p className="text-[11px] text-mutedtext">{t("searchesHelp")}</p>
          {extras.searches.length === 0 ? (
            <p className="text-sm text-mutedtext">{t("none")}</p>
          ) : (
            <ul className="divide-y divide-borderstrong/40 text-sm">
              {extras.searches.map((s) => (
                <li key={s.term} className="flex items-center justify-between gap-3 py-1.5">
                  <Link href={{ pathname: "/dashboard/store/suppliers/lookup" }} className="text-heading hover:text-cobalt" dir="auto">
                    “{s.term}”
                  </Link>
                  <span className="shrink-0 tabular-nums text-mutedtext">
                    {t("times", { n: s.n })} · {date(s.last_seen)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="neu space-y-2 p-4">
          <h2 className="text-base font-bold text-heading">{t("bomTitle")}</h2>
          <p className="text-[11px] text-mutedtext">{t("bomHelp", { weight: bomWeight })}</p>
          {extras.bom.length === 0 ? (
            <p className="text-sm text-mutedtext">{t("none")}</p>
          ) : (
            <ul className="divide-y divide-borderstrong/40 text-sm">
              {extras.bom.map((b) => (
                <li key={b.label} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-heading" dir="auto">
                    {b.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-mutedtext">
                    {t("bomLine", { score: b.projects * bomWeight, projects: b.projects, qty: b.quantity })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Did stocking convert? */}
      <section className="neu space-y-2 p-4">
        <h2 className="text-base font-bold text-heading">{t("receiptsTitle")}</h2>
        {extras.receipts.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("noReceipts")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-mutedtext">
                  <th className="py-1 text-start">{t("col_product")}</th>
                  <th className="py-1 text-start">{t("col_received")}</th>
                  <th className="py-1 text-end">{t("col_qty")}</th>
                  <th className="py-1 text-end">{t("col_served")}</th>
                  <th className="py-1 text-end">{t("col_cartsSince")}</th>
                  <th className="py-1 text-end">{t("col_soldSince")}</th>
                </tr>
              </thead>
              <tbody>
                {extras.receipts.map((r) => (
                  <tr key={r.id} className="border-t border-borderstrong/30">
                    <td className="py-1.5 text-heading">{r.part_name}</td>
                    <td className="py-1.5 text-mutedtext">{date(r.received_at)}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.quantity}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.served}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.carts_since}</td>
                    <td className="py-1.5 text-end tabular-nums font-semibold text-heading">{r.sold_since}</td>
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

function ReceiveForm({ defaultQty, onSave, onCancel, pending }: { defaultQty: number; onSave: (q: number) => void; onCancel: () => void; pending: boolean }) {
  const t = useTranslations("Restock");
  const [q, setQ] = useState(String(defaultQty));
  return (
    <div className="flex items-center gap-1">
      <input value={q} onChange={(e) => setQ(e.target.value)} inputMode="numeric" aria-label={t("qty")} className={cn(input, "w-14 text-end")} dir="ltr" />
      <button type="button" disabled={pending} onClick={() => onSave(Number(q))} className="rounded-full bg-emerald-600 p-1 text-white disabled:opacity-50" aria-label={t("confirmReceived")}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <button type="button" onClick={onCancel} className="px-1 text-[11px] text-mutedtext">
        {t("cancel")}
      </button>
    </div>
  );
}

function MinimumEditor({ locale, supplierId, value, below, total }: { locale: string; supplierId: string; value: number | null; below: boolean; total: number }) {
  const t = useTranslations("Restock");
  const router = useRouter();
  const [v, setV] = useState(value === null ? "" : String(value));
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-mutedtext">
      {t("minimum")}
      <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" className={cn(input, "w-20 text-end")} dir="ltr" aria-label={t("minimum")} />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await saveSupplierMinimum(locale, supplierId, v.trim() === "" ? null : Number(v));
            router.refresh();
          })
        }
        className="rounded-full p-1 text-cobalt hover:bg-surface"
        aria-label={t("save")}
      >
        <Save className="h-3.5 w-3.5" />
      </button>
      {value !== null &&
        (below ? (
          <span className="font-semibold text-red-700">{t("belowMinimum", { short: formatPrice(value - total, locale) })}</span>
        ) : (
          <span className="font-semibold text-emerald-700">{t("aboveMinimum")}</span>
        ))}
    </span>
  );
}

function WeightsEditor({ locale, initial }: { locale: string; initial: RestockWeights }) {
  const t = useTranslations("Restock");
  const router = useRouter();
  const [w, setW] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="neu p-4">
      <summary className="cursor-pointer text-sm font-semibold text-heading">
        {t("weightsTitle", { request: initial.request, bom: initial.bom_unmatched, cart: initial.add_to_cart, view: initial.view })}
      </summary>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {(Object.keys(initial) as (keyof RestockWeights)[]).map((k) => (
          <label key={k} className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t(`w_${k}`)}</span>
            <input
              value={String(w[k])}
              onChange={(e) => setW({ ...w, [k]: e.target.value as unknown as number })}
              inputMode="decimal"
              className={cn(input, "w-20 text-end")}
              dir="ltr"
            />
          </label>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveRestockWeights(locale, w);
              setMsg(r.error ?? t("saved"));
              router.refresh();
            })
          }
          className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("save")}
        </button>
        {msg && <span className="text-sm text-mutedtext">{msg}</span>}
      </div>
    </details>
  );
}
